-- Expose only the RSVP-submitted name to lodging users, without exposing
-- arbitrary custom RSVP answers or other guest contact details.
drop function public.get_workspace_lodging(uuid);

create function public.get_workspace_lodging(requested_workspace_id uuid)
returns table (
  id uuid,
  workspace_id uuid,
  family_name text,
  rsvp_guest_name text,
  guest_count integer,
  room_count integer,
  assigned_room_numbers text[],
  checked_in boolean,
  checked_out boolean
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
  select g.id,
         g.workspace_id,
         g.family_name,
         case
           when g.public_rsvp_custom_answers ? 'guest_entered_name'
             then nullif(trim(g.public_rsvp_custom_answers->'guest_entered_name'->>'value'), '')
           else null
         end,
         g.guest_count,
         g.room_count,
         g.assigned_room_numbers,
         g.checked_in,
         g.checked_out
  from public.guest_groups g
  where g.workspace_id = requested_workspace_id
    and g.archived_at is null
  order by lower(g.family_name);
end;
$$;

revoke all on function public.get_workspace_lodging(uuid) from public, anon;
grant execute on function public.get_workspace_lodging(uuid) to authenticated;
