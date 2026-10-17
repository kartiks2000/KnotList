-- The lodging view should contain confirmed, non-card-only guests and cannot
-- change the RSVP headcount while editing room assignments.
drop function public.get_workspace_lodging(uuid);

create function public.get_workspace_lodging(requested_workspace_id uuid)
returns table (
  id uuid,
  workspace_id uuid,
  family_name text,
  guest_count integer,
  room_count integer,
  assigned_room_numbers text[],
  checked_in boolean,
  checked_out boolean,
  rsvp_status text,
  card_only boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required' using errcode = '28000';
  end if;
  if not public.has_permission('lodging.read', requested_workspace_id) then
    raise exception 'You do not have permission to read lodging data in this workspace' using errcode = '42501';
  end if;

  return query
  select g.id, g.workspace_id, g.family_name, g.guest_count, g.room_count,
         g.assigned_room_numbers, g.checked_in, g.checked_out, g.rsvp_status, g.card_only
  from public.guest_groups g
  where g.workspace_id = requested_workspace_id
    and g.archived_at is null
    and g.rsvp_status = 'confirmed'
    and not g.card_only
  order by lower(g.family_name);
end;
$$;

revoke all on function public.get_workspace_lodging(uuid) from public, anon;
grant execute on function public.get_workspace_lodging(uuid) to authenticated;

-- Keep the existing RPC signature for app-version compatibility, but ignore
-- requested_guest_count so lodging edits cannot overwrite the RSVP headcount.
do $migration$
declare
  function_definition text;
  old_assignment constant text := $old$set guest_count = requested_guest_count,
      room_count = requested_room_count,$old$;
  new_assignment constant text := $new$set room_count = requested_room_count,$new$;
begin
  function_definition := pg_get_functiondef(
    'public.update_workspace_lodging(uuid,uuid,integer,integer,text[],boolean,boolean)'::regprocedure
  );

  if position(new_assignment in function_definition) = 0 then
    if position(old_assignment in function_definition) = 0 then
      raise exception 'Could not find the guest-count update in update_workspace_lodging';
    end if;
    function_definition := replace(function_definition, old_assignment, new_assignment);
    execute function_definition;
  end if;
end;
$migration$;
