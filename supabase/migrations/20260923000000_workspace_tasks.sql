-- Keep simple planning tasks in the workspace. Members can create tasks for
-- themselves and comment; Admins can assign tasks to other workspace Admins.

insert into public.permissions (key, description) values
  ('tasks.manage', 'Create, assign, update, and complete tasks in an assigned workspace.')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.workspace_id is null
  and r.key = 'admin'
  and p.key = 'tasks.manage'
on conflict do nothing;


create table public.workspace_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 180),
  description text not null default '',
  constraint workspace_tasks_description_length_check check (length(description) <= 2000),
  assigned_to uuid references auth.users (id) on delete set null,
  deadline date,
  is_completed boolean not null default false,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create index workspace_tasks_workspace_status_idx
  on public.workspace_tasks (workspace_id, is_completed, deadline);
create index workspace_tasks_assignee_idx
  on public.workspace_tasks (workspace_id, assigned_to)
  where assigned_to is not null;

create table public.workspace_task_comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  task_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  author_name text not null default '',
  body text not null check (length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  constraint workspace_task_comments_task_fk
    foreign key (task_id, workspace_id)
    references public.workspace_tasks (id, workspace_id) on delete cascade
);

create index workspace_task_comments_task_created_idx
  on public.workspace_task_comments (task_id, created_at);

create trigger workspace_tasks_set_updated_at
  before update on public.workspace_tasks
  for each row execute procedure public.set_updated_at();

create or replace function public.validate_workspace_task_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_to is null then
    if tg_op = 'INSERT' then
      raise exception 'Assign this task to a workspace admin';
    end if;
    return new;
  end if;

  if new.assigned_to = auth.uid() and exists (
    select 1 from public.workspace_memberships wm
    where wm.workspace_id = new.workspace_id and wm.user_id = auth.uid()
  ) then
    return new;
  end if;

  if not exists (
    select 1
    from public.workspace_memberships wm
    join public.role_permissions rp on rp.role_id = wm.role_id
    where wm.workspace_id = new.workspace_id
      and wm.user_id = new.assigned_to
      and rp.permission_key = 'app_data.manage'
  ) then
    raise exception 'Tasks can only be assigned to an admin in this planning space';
  end if;

  return new;
end;
$$;

create trigger workspace_tasks_validate_assignee
  before insert or update of workspace_id, assigned_to on public.workspace_tasks
  for each row execute procedure public.validate_workspace_task_assignee();
revoke all on function public.validate_workspace_task_assignee() from public, anon, authenticated;

create or replace function public.set_workspace_task_comment_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required' using errcode = '28000';
  end if;

  new.user_id := auth.uid();
  new.body := trim(new.body);
  select coalesce(nullif(trim(p.display_name), ''), u.email, 'Planning space member')
    into new.author_name
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = auth.uid();

  return new;
end;
$$;

create trigger workspace_task_comments_set_author
  before insert on public.workspace_task_comments
  for each row execute procedure public.set_workspace_task_comment_author();
revoke all on function public.set_workspace_task_comment_author() from public, anon, authenticated;

alter table public.workspace_tasks enable row level security;
alter table public.workspace_task_comments enable row level security;

create policy "Workspace task readers can read tasks"
  on public.workspace_tasks for select to authenticated
  using (public.has_permission('tasks.manage', workspace_id));
create policy "Workspace task managers can create tasks"
  on public.workspace_tasks for insert to authenticated
  with check (
    public.has_permission('tasks.manage', workspace_id)
    and (assigned_to = auth.uid() or public.has_permission('tasks.manage', workspace_id))
  );
create policy "Workspace task managers can update tasks"
  on public.workspace_tasks for update to authenticated
  using (public.has_permission('tasks.manage', workspace_id))
  with check (public.has_permission('tasks.manage', workspace_id));
create policy "Workspace task managers can delete tasks"
  on public.workspace_tasks for delete to authenticated
  using (public.has_permission('tasks.manage', workspace_id));

create policy "Workspace task readers can read comments"
  on public.workspace_task_comments for select to authenticated
  using (public.has_permission('tasks.manage', workspace_id));
create policy "Workspace members can add task comments"
  on public.workspace_task_comments for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.has_permission('tasks.manage', workspace_id)
    and exists (
      select 1 from public.workspace_tasks t
      where t.id = task_id and t.workspace_id = workspace_id
    )
  );

grant select, insert, update, delete on public.workspace_tasks to authenticated;
grant select, insert on public.workspace_task_comments to authenticated;

create or replace function public.set_workspace_task_completion(
  requested_workspace_id uuid,
  requested_task_id uuid,
  requested_is_completed boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_task_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required' using errcode = '28000';
  end if;

  update public.workspace_tasks t
  set is_completed = requested_is_completed,
      updated_at = now()
  where t.id = requested_task_id
    and t.workspace_id = requested_workspace_id
    and public.has_permission('tasks.manage', t.workspace_id)
    and (t.assigned_to = auth.uid() or public.has_permission('tasks.manage', t.workspace_id))
  returning t.id into updated_task_id;

  if updated_task_id is null then
    raise exception 'You cannot update this task' using errcode = '42501';
  end if;

  return true;
end;
$$;
revoke all on function public.set_workspace_task_completion(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_workspace_task_completion(uuid, uuid, boolean) to authenticated;

create or replace function public.get_workspace_task_assignees(requested_workspace_id uuid)
returns table (user_id uuid, display_name text, email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required' using errcode = '28000';
  end if;
  if not public.has_permission('tasks.manage', requested_workspace_id) then
    raise exception 'You do not have permission to read tasks in this workspace' using errcode = '42501';
  end if;

  return query
  select wm.user_id, coalesce(nullif(trim(p.display_name), ''), 'Workspace member'), p.email
  from public.workspace_memberships wm
  join public.role_permissions rp on rp.role_id = wm.role_id and rp.permission_key = 'app_data.manage'
  left join public.profiles p on p.id = wm.user_id
  where wm.workspace_id = requested_workspace_id
  group by wm.user_id, p.display_name, p.email
  order by coalesce(nullif(trim(p.display_name), ''), 'Workspace member');
end;
$$;

grant execute on function public.get_workspace_task_assignees(uuid) to authenticated;
revoke all on function public.get_workspace_task_assignees(uuid) from public, anon;
