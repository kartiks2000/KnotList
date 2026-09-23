alter table public.guest_groups
  add column checked_in boolean not null default false,
  add column checked_out boolean not null default false;

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
  select g.id, g.workspace_id, g.family_name, g.guest_count, g.room_count,
         g.assigned_room_numbers, g.checked_in, g.checked_out
  from public.guest_groups g
  where g.workspace_id = requested_workspace_id
    and g.archived_at is null
  order by lower(g.family_name);
end;
$$;

drop function public.update_workspace_lodging(uuid, uuid, integer, integer, text[]);

create function public.update_workspace_lodging(
  requested_workspace_id uuid,
  requested_guest_group_id uuid,
  requested_guest_count integer,
  requested_room_count integer,
  requested_room_numbers text[],
  requested_checked_in boolean,
  requested_checked_out boolean
)
returns table (
  id uuid,
  workspace_id uuid,
  family_name text,
  guest_count integer,
  room_count integer,
  assigned_room_numbers text[],
  checked_in boolean,
  checked_out boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required' using errcode = '28000';
  end if;
  if not public.has_permission('lodging.manage', requested_workspace_id) then
    raise exception 'You do not have permission to update lodging data in this workspace' using errcode = '42501';
  end if;
  if requested_checked_out and not requested_checked_in then
    raise exception 'A guest must be checked in before being checked out' using errcode = '22023';
  end if;

  return query
  update public.guest_groups g
  set guest_count = requested_guest_count,
      room_count = requested_room_count,
      assigned_room_numbers = coalesce(requested_room_numbers, '{}'::text[]),
      checked_in = requested_checked_in,
      checked_out = requested_checked_out,
      updated_by = auth.uid()
  where g.id = requested_guest_group_id
    and g.workspace_id = requested_workspace_id
    and g.archived_at is null
  returning g.id, g.workspace_id, g.family_name, g.guest_count, g.room_count,
            g.assigned_room_numbers, g.checked_in, g.checked_out;

  if not found then
    raise exception 'Guest family not found in this workspace' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.get_workspace_lodging(uuid) from public, anon;
revoke all on function public.update_workspace_lodging(uuid, uuid, integer, integer, text[], boolean, boolean) from public, anon;
grant execute on function public.get_workspace_lodging(uuid) to authenticated;
grant execute on function public.update_workspace_lodging(uuid, uuid, integer, integer, text[], boolean, boolean) to authenticated;

create function public.update_workspace_lodging_status(
  requested_workspace_id uuid,
  requested_guest_group_id uuid,
  requested_checked_in boolean,
  requested_checked_out boolean
)
returns table (id uuid, checked_in boolean, checked_out boolean)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required' using errcode = '28000';
  end if;
  if not public.has_permission('lodging.manage', requested_workspace_id) then
    raise exception 'You do not have permission to manage lodging in this workspace' using errcode = '42501';
  end if;
  if requested_checked_out and not requested_checked_in then
    raise exception 'A guest must be checked in before being checked out' using errcode = '22023';
  end if;

  return query
  update public.guest_groups g
  set checked_in = requested_checked_in,
      checked_out = requested_checked_out,
      updated_by = auth.uid()
  where g.id = requested_guest_group_id
    and g.workspace_id = requested_workspace_id
    and g.archived_at is null
  returning g.id, g.checked_in, g.checked_out;

  if not found then
    raise exception 'Guest family not found in this workspace' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.update_workspace_lodging_status(uuid, uuid, boolean, boolean) from public, anon;
grant execute on function public.update_workspace_lodging_status(uuid, uuid, boolean, boolean) to authenticated;
