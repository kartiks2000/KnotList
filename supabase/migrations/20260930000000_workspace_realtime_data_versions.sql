-- Publish a data-only version signal for workspace modules. The table contains
-- no guest or task details, so lodging-only users can safely subscribe without
-- exposing columns from guest_groups.
create table if not exists public.workspace_data_versions (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  updated_at timestamptz not null default now()
);

insert into public.workspace_data_versions (workspace_id)
select id from public.workspaces
on conflict (workspace_id) do nothing;

alter table public.workspace_data_versions enable row level security;
revoke all on public.workspace_data_versions from public, anon, authenticated;
grant select on public.workspace_data_versions to authenticated;

drop policy if exists "Workspace members can read data change signals" on public.workspace_data_versions;
create policy "Workspace members can read data change signals"
  on public.workspace_data_versions for select to authenticated
  using (
    public.has_permission('app_data.read', workspace_id)
    or public.has_permission('lodging.read', workspace_id)
    or public.has_permission('gifts.read', workspace_id)
    or public.has_permission('tasks.manage', workspace_id)
  );

create or replace function public.bump_workspace_data_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_workspace_id uuid;
begin
  if tg_op = 'DELETE' then
    affected_workspace_id := old.workspace_id;
  else
    affected_workspace_id := new.workspace_id;
  end if;

  insert into public.workspace_data_versions (workspace_id, updated_at)
  values (affected_workspace_id, clock_timestamp())
  on conflict (workspace_id) do update
    set updated_at = excluded.updated_at;

  if tg_op = 'UPDATE' and old.workspace_id is distinct from new.workspace_id then
    insert into public.workspace_data_versions (workspace_id, updated_at)
    values (old.workspace_id, clock_timestamp())
    on conflict (workspace_id) do update
      set updated_at = excluded.updated_at;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.create_workspace_data_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspace_data_versions (workspace_id)
  values (new.id)
  on conflict (workspace_id) do nothing;
  return new;
end;
$$;

drop trigger if exists workspaces_create_data_version on public.workspaces;
create trigger workspaces_create_data_version
  after insert on public.workspaces
  for each row execute procedure public.create_workspace_data_version();

drop trigger if exists guest_groups_bump_data_version on public.guest_groups;
create trigger guest_groups_bump_data_version
  after insert or update or delete on public.guest_groups
  for each row execute procedure public.bump_workspace_data_version();

drop trigger if exists workspace_tasks_bump_data_version on public.workspace_tasks;
create trigger workspace_tasks_bump_data_version
  after insert or update or delete on public.workspace_tasks
  for each row execute procedure public.bump_workspace_data_version();

drop trigger if exists workspace_task_comments_bump_data_version on public.workspace_task_comments;
create trigger workspace_task_comments_bump_data_version
  after insert or update or delete on public.workspace_task_comments
  for each row execute procedure public.bump_workspace_data_version();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'workspace_data_versions'
  ) then
    alter publication supabase_realtime add table public.workspace_data_versions;
  end if;
end;
$$;
