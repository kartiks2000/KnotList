create table public.workspace_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  guest_group_id uuid references public.guest_groups (id) on delete set null,
  event_type text not null check (event_type in ('checked_in', 'checked_out')),
  guest_name text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index workspace_notifications_user_created_idx
  on public.workspace_notifications (user_id, workspace_id, created_at desc);

create table public.lodging_notification_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users (id) on delete set null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  guest_group_id uuid references public.guest_groups (id) on delete set null,
  event_type text not null check (event_type in ('checked_in', 'checked_out')),
  guest_name text not null,
  created_at timestamptz not null default now(),
  push_claimed_at timestamptz
);

alter table public.lodging_notification_events enable row level security;
alter table public.workspace_notifications
  add column event_id uuid references public.lodging_notification_events (id) on delete cascade;

alter table public.workspace_notifications enable row level security;
grant select on public.workspace_notifications to authenticated;
grant update (read_at) on public.workspace_notifications to authenticated;

create policy "Users can read their lodging notifications"
  on public.workspace_notifications for select to authenticated
  using (user_id = auth.uid() and public.has_permission('lodging.read', workspace_id));

create policy "Users can mark their lodging notifications read"
  on public.workspace_notifications for update to authenticated
  using (user_id = auth.uid() and public.has_permission('lodging.read', workspace_id))
  with check (user_id = auth.uid() and public.has_permission('lodging.read', workspace_id));

create table public.browser_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index browser_push_subscriptions_user_idx
  on public.browser_push_subscriptions (user_id);

alter table public.browser_push_subscriptions enable row level security;
grant select, insert, delete on public.browser_push_subscriptions to authenticated;
grant update (endpoint, p256dh, auth, updated_at) on public.browser_push_subscriptions to authenticated;

create policy "Users can manage their own push subscriptions"
  on public.browser_push_subscriptions for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create function public.get_lodging_notification_recipient_ids(requested_workspace_id uuid)
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
    and rp.permission_key = 'lodging.read'
  union
  select pr.user_id
  from public.platform_roles pr
  join public.roles r on r.id = pr.role_id
  where r.key = 'super_admin';
$$;

revoke all on function public.get_lodging_notification_recipient_ids(uuid) from public, anon, authenticated;
grant execute on function public.get_lodging_notification_recipient_ids(uuid) to service_role;

alter publication supabase_realtime add table public.workspace_notifications;

drop function public.update_workspace_lodging_status(uuid, uuid, boolean, boolean);

create function public.update_workspace_lodging_status(
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
    raise exception 'Guest family not found in this workspace' using errcode = 'P0002';
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
    insert into public.lodging_notification_events as new_event (actor_user_id, workspace_id, guest_group_id, event_type, guest_name)
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
