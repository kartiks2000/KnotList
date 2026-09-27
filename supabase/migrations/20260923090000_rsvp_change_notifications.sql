-- Add admin-only RSVP notifications to the shared in-app and browser-push flow.
alter table public.workspace_notifications
  drop constraint workspace_notifications_event_type_check,
  add constraint workspace_notifications_event_type_check
    check (event_type in ('checked_in', 'checked_out', 'rsvp_confirmed', 'rsvp_maybe', 'rsvp_declined'));

alter table public.lodging_notification_events
  drop constraint lodging_notification_events_event_type_check,
  add constraint lodging_notification_events_event_type_check
    check (event_type in ('checked_in', 'checked_out', 'rsvp_confirmed', 'rsvp_maybe', 'rsvp_declined'));

drop policy if exists "Users can read their lodging notifications" on public.workspace_notifications;
drop policy if exists "Users can read their workspace notifications" on public.workspace_notifications;
create policy "Users can read their workspace notifications"
  on public.workspace_notifications for select to authenticated
  using (
    user_id = auth.uid()
    and (
      public.has_permission('lodging.read', workspace_id)
      or public.has_permission('app_data.read', workspace_id)
    )
  );

drop policy if exists "Users can mark their lodging notifications read" on public.workspace_notifications;
drop policy if exists "Users can mark their workspace notifications read" on public.workspace_notifications;
create policy "Users can mark their workspace notifications read"
  on public.workspace_notifications for update to authenticated
  using (
    user_id = auth.uid()
    and (
      public.has_permission('lodging.read', workspace_id)
      or public.has_permission('app_data.read', workspace_id)
    )
  )
  with check (
    user_id = auth.uid()
    and (
      public.has_permission('lodging.read', workspace_id)
      or public.has_permission('app_data.read', workspace_id)
    )
  );

create or replace function public.get_workspace_rsvp_notification_recipient_ids(requested_workspace_id uuid)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct wm.user_id
  from public.workspace_memberships wm
  join public.role_permissions rp on rp.role_id = wm.role_id
  where wm.workspace_id = requested_workspace_id
    and rp.permission_key = 'app_data.read'
  union
  select pr.user_id
  from public.platform_roles pr
  join public.roles r on r.id = pr.role_id
  where r.key = 'super_admin';
$$;

revoke all on function public.get_workspace_rsvp_notification_recipient_ids(uuid) from public, anon, authenticated;
grant execute on function public.get_workspace_rsvp_notification_recipient_ids(uuid) to service_role;

alter table public.guest_groups
  add column if not exists last_rsvp_notification_event_id uuid references public.lodging_notification_events (id) on delete set null;

create or replace function public.notify_workspace_rsvp_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  notification_type text;
  new_event_id uuid;
begin
  if old.rsvp_status is not distinct from new.rsvp_status
     or new.rsvp_status not in ('confirmed', 'maybe', 'declined') then
    return new;
  end if;

  notification_type := 'rsvp_' || new.rsvp_status;

  insert into public.lodging_notification_events as new_event
    (actor_user_id, workspace_id, guest_group_id, event_type, guest_name)
  values (auth.uid(), new.workspace_id, new.id, notification_type, new.family_name)
  returning new_event.id into new_event_id;

  new.last_rsvp_notification_event_id := new_event_id;

  insert into public.workspace_notifications (user_id, workspace_id, guest_group_id, event_type, guest_name, event_id)
  select recipients.user_id, new.workspace_id, new.id, notification_type, new.family_name, new_event_id
  from (
    select distinct wm.user_id
    from public.workspace_memberships wm
    join public.role_permissions rp on rp.role_id = wm.role_id
    where wm.workspace_id = new.workspace_id
      and rp.permission_key = 'app_data.read'
    union
    select pr.user_id
    from public.platform_roles pr
    join public.roles r on r.id = pr.role_id
    where r.key = 'super_admin'
  ) recipients
  where recipients.user_id <> auth.uid();

  return new;
end;
$$;

drop trigger if exists guest_groups_notify_rsvp_change on public.guest_groups;
create trigger guest_groups_notify_rsvp_change
  before update of rsvp_status on public.guest_groups
  for each row execute function public.notify_workspace_rsvp_change();
