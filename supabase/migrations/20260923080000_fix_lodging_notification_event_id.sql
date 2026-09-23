-- The OUT column `id` makes an unqualified RETURNING id ambiguous in PL/pgSQL.
-- Qualify the inserted event id and replace the deployed status RPC.
create or replace function public.update_workspace_lodging_status(
  requested_workspace_id uuid,
  requested_guest_group_id uuid,
  requested_checked_in boolean,
  requested_checked_out boolean
)
returns table (id uuid, checked_in boolean, checked_out boolean, notification_event_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_row public.guest_groups%rowtype;
  updated_row public.guest_groups%rowtype;
  notification_type text;
  new_event_id uuid;
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

  select g.* into previous_row
  from public.guest_groups g
  where g.id = requested_guest_group_id
    and g.workspace_id = requested_workspace_id
    and g.archived_at is null
  for update;

  if not found then
    raise exception 'Guest not found in this workspace' using errcode = 'P0002';
  end if;

  update public.guest_groups g
  set checked_in = requested_checked_in,
      checked_out = requested_checked_out,
      updated_by = auth.uid()
  where g.id = requested_guest_group_id
    and g.workspace_id = requested_workspace_id
  returning g.* into updated_row;

  if not previous_row.checked_in and updated_row.checked_in then
    notification_type := 'checked_in';
  elsif not previous_row.checked_out and updated_row.checked_out then
    notification_type := 'checked_out';
  else
    notification_type := null;
  end if;

  if notification_type is not null then
    insert into public.lodging_notification_events as new_event
      (actor_user_id, workspace_id, guest_group_id, event_type, guest_name)
    values (auth.uid(), requested_workspace_id, updated_row.id, notification_type, updated_row.family_name)
    returning new_event.id into new_event_id;

    insert into public.workspace_notifications (user_id, workspace_id, guest_group_id, event_type, guest_name, event_id)
    select recipients.user_id, requested_workspace_id, updated_row.id, notification_type, updated_row.family_name, new_event_id
    from (
      select distinct wm.user_id
      from public.workspace_memberships wm
      join public.role_permissions rp on rp.role_id = wm.role_id
      where wm.workspace_id = requested_workspace_id
        and rp.permission_key = 'lodging.read'
      union
      select pr.user_id
      from public.platform_roles pr
      join public.roles r on r.id = pr.role_id
      where r.key = 'super_admin'
    ) recipients
    where recipients.user_id <> auth.uid();
  end if;

  return query select updated_row.id, updated_row.checked_in, updated_row.checked_out, new_event_id;
end;
$$;

revoke all on function public.update_workspace_lodging_status(uuid, uuid, boolean, boolean) from public, anon;
grant execute on function public.update_workspace_lodging_status(uuid, uuid, boolean, boolean) to authenticated;
