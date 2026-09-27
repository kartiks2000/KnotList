-- Send in-app and browser-push notifications for task creation and comments.
alter table public.workspace_notifications
  add column if not exists notification_detail text,
  drop constraint workspace_notifications_event_type_check,
  add constraint workspace_notifications_event_type_check
    check (event_type in ('checked_in', 'checked_out', 'rsvp_confirmed', 'rsvp_maybe', 'rsvp_declined', 'task_created', 'task_comment'));

alter table public.lodging_notification_events
  add column if not exists task_id uuid references public.workspace_tasks (id) on delete set null,
  add column if not exists task_comment_id uuid references public.workspace_task_comments (id) on delete set null,
  add column if not exists notification_detail text,
  drop constraint lodging_notification_events_event_type_check,
  add constraint lodging_notification_events_event_type_check
    check (event_type in ('checked_in', 'checked_out', 'rsvp_confirmed', 'rsvp_maybe', 'rsvp_declined', 'task_created', 'task_comment'));

drop policy if exists "Users can read their workspace notifications" on public.workspace_notifications;
create policy "Users can read their workspace notifications"
  on public.workspace_notifications for select to authenticated
  using (
    user_id = auth.uid()
    and (
      public.has_permission('lodging.read', workspace_id)
      or public.has_permission('app_data.read', workspace_id)
      or public.has_permission('tasks.manage', workspace_id)
    )
  );

drop policy if exists "Users can mark their workspace notifications read" on public.workspace_notifications;
create policy "Users can mark their workspace notifications read"
  on public.workspace_notifications for update to authenticated
  using (
    user_id = auth.uid()
    and (
      public.has_permission('lodging.read', workspace_id)
      or public.has_permission('app_data.read', workspace_id)
      or public.has_permission('tasks.manage', workspace_id)
    )
  )
  with check (
    user_id = auth.uid()
    and (
      public.has_permission('lodging.read', workspace_id)
      or public.has_permission('app_data.read', workspace_id)
      or public.has_permission('tasks.manage', workspace_id)
    )
  );

drop policy if exists "Users can delete their own workspace notifications" on public.workspace_notifications;
create policy "Users can delete their own workspace notifications"
  on public.workspace_notifications for delete to authenticated
  using (
    user_id = auth.uid()
    and (
      public.has_permission('lodging.read', workspace_id)
      or public.has_permission('app_data.read', workspace_id)
      or public.has_permission('tasks.manage', workspace_id)
    )
  );

create or replace function public.get_workspace_task_notification_recipient_ids(requested_workspace_id uuid)
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
    and rp.permission_key = 'tasks.manage'
  union
  select pr.user_id
  from public.platform_roles pr
  join public.roles r on r.id = pr.role_id
  where r.key = 'super_admin';
$$;

revoke all on function public.get_workspace_task_notification_recipient_ids(uuid) from public, anon, authenticated;
grant execute on function public.get_workspace_task_notification_recipient_ids(uuid) to service_role;

create or replace function public.notify_workspace_task_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_event_id uuid;
begin
  insert into public.lodging_notification_events
    (actor_user_id, workspace_id, task_id, event_type, guest_name)
  values (new.created_by, new.workspace_id, new.id, 'task_created', new.title)
  returning id into new_event_id;

  insert into public.workspace_notifications
    (user_id, workspace_id, event_type, guest_name, event_id)
  select recipients.user_id, new.workspace_id, 'task_created', new.title, new_event_id
  from (
    select distinct wm.user_id
    from public.workspace_memberships wm
    join public.role_permissions rp on rp.role_id = wm.role_id
    where wm.workspace_id = new.workspace_id
      and rp.permission_key = 'tasks.manage'
    union
    select pr.user_id
    from public.platform_roles pr
    join public.roles r on r.id = pr.role_id
    where r.key = 'super_admin'
  ) recipients
  where recipients.user_id <> new.created_by;

  return new;
end;
$$;

drop trigger if exists workspace_tasks_notify_created on public.workspace_tasks;
create trigger workspace_tasks_notify_created
  after insert on public.workspace_tasks
  for each row execute function public.notify_workspace_task_created();
revoke all on function public.notify_workspace_task_created() from public, anon, authenticated;

create or replace function public.notify_workspace_task_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_title text;
  new_event_id uuid;
begin
  select t.title into task_title
  from public.workspace_tasks t
  where t.id = new.task_id and t.workspace_id = new.workspace_id;

  if task_title is null then
    return new;
  end if;

  insert into public.lodging_notification_events
    (actor_user_id, workspace_id, task_id, task_comment_id, event_type, guest_name, notification_detail)
  values (new.user_id, new.workspace_id, new.task_id, new.id, 'task_comment', task_title, new.body)
  returning id into new_event_id;

  insert into public.workspace_notifications
    (user_id, workspace_id, event_type, guest_name, event_id, notification_detail)
  select recipients.user_id, new.workspace_id, 'task_comment', task_title, new_event_id, new.body
  from (
    select distinct wm.user_id
    from public.workspace_memberships wm
    join public.role_permissions rp on rp.role_id = wm.role_id
    where wm.workspace_id = new.workspace_id
      and rp.permission_key = 'tasks.manage'
    union
    select pr.user_id
    from public.platform_roles pr
    join public.roles r on r.id = pr.role_id
    where r.key = 'super_admin'
  ) recipients
  where recipients.user_id <> new.user_id;

  return new;
end;
$$;

drop trigger if exists workspace_task_comments_notify_created on public.workspace_task_comments;
create trigger workspace_task_comments_notify_created
  after insert on public.workspace_task_comments
  for each row execute function public.notify_workspace_task_comment();
revoke all on function public.notify_workspace_task_comment() from public, anon, authenticated;

create or replace function public.get_workspace_task_notification_event_id(
  requested_task_id uuid,
  requested_comment_id uuid default null
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
  from public.lodging_notification_events e
  where e.actor_user_id = auth.uid()
    and public.has_permission('tasks.manage', e.workspace_id)
    and (
      (requested_comment_id is null and e.task_id = requested_task_id and e.event_type = 'task_created')
      or (requested_comment_id is not null and e.task_id = requested_task_id and e.task_comment_id = requested_comment_id and e.event_type = 'task_comment')
    )
  order by e.created_at desc
  limit 1;
$$;

revoke all on function public.get_workspace_task_notification_event_id(uuid, uuid) from public, anon;
grant execute on function public.get_workspace_task_notification_event_id(uuid, uuid) to authenticated;
