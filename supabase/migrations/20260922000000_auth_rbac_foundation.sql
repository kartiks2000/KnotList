-- Identity, workspace membership, and database-enforced authorization.
-- Wedding planning tables should reference workspace_id and use has_permission().

create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'Application profile fields for Supabase Auth users.';

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
comment on table public.workspaces is 'A private planning space. Future wedding data is scoped to a workspace.';

create table public.permissions (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  description text not null default ''
);
comment on table public.permissions is 'Permission catalog; extend with migrations as new capabilities are added.';

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  name text not null check (length(trim(name)) between 1 and 80),
  description text not null default '',
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  constraint system_roles_are_global check (not is_system or workspace_id is null)
);
create unique index roles_global_key_unique on public.roles (key) where workspace_id is null;
create unique index roles_workspace_key_unique on public.roles (workspace_id, key) where workspace_id is not null;
comment on table public.roles is 'Global system roles and workspace-scoped custom role definitions.';

create table public.role_permissions (
  role_id uuid not null references public.roles (id) on delete cascade,
  permission_key text not null references public.permissions (key) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_key)
);

create table public.workspace_memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index workspace_memberships_user_idx on public.workspace_memberships (user_id, workspace_id);
create index workspace_memberships_role_idx on public.workspace_memberships (role_id);
comment on table public.workspace_memberships is 'Assigns one role to each user in each workspace.';

create table public.platform_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);
comment on table public.platform_roles is 'Platform-wide roles; initially reserved for super_admin.';

insert into public.permissions (key, description) values
  ('app_data.read', 'Read application data in an assigned workspace.'),
  ('app_data.manage', 'Create, update, and delete application data in an assigned workspace.'),
  ('roles.manage', 'Create and manage role definitions.'),
  ('users.manage', 'Manage workspace memberships and user access.'),
  ('workspace.read', 'Read workspace details.'),
  ('workspace.manage', 'Manage workspace settings.')
on conflict (key) do nothing;

insert into public.roles (workspace_id, key, name, description, is_system) values
  (null, 'super_admin', 'Super admin', 'Platform-wide access and role administration.', true),
  (null, 'admin', 'Admin', 'Manage application data in assigned workspaces.', true)
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.workspace_id is null
  and ((r.key = 'super_admin') or (r.key = 'admin' and p.key in ('app_data.read', 'app_data.manage', 'workspace.read')))
on conflict do nothing;

create or replace function public.has_permission(requested_permission text, requested_workspace_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    exists (
      select 1
      from public.platform_roles pr
      join public.roles r on r.id = pr.role_id
      where pr.user_id = auth.uid() and r.key = 'super_admin'
    )
    or (
      requested_workspace_id is not null
      and exists (
        select 1
        from public.workspace_memberships wm
        join public.roles r on r.id = wm.role_id
        join public.role_permissions rp on rp.role_id = r.id
        where wm.user_id = auth.uid()
          and wm.workspace_id = requested_workspace_id
          and rp.permission_key = requested_permission
      )
    )
  );
$$;
comment on function public.has_permission(text, uuid) is 'RLS helper for platform and workspace-scoped permission checks.';

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute procedure public.set_updated_at();

create or replace function public.validate_workspace_membership_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  assigned_workspace_id uuid;
  assigned_role_key text;
begin
  select r.workspace_id, r.key into assigned_workspace_id, assigned_role_key
  from public.roles r where r.id = new.role_id;

  if not found or assigned_role_key = 'super_admin' then
    raise exception 'Invalid workspace role';
  end if;

  if assigned_workspace_id is null and assigned_role_key <> 'admin' then
    raise exception 'Only the built-in admin role can be assigned across workspaces';
  end if;

  if assigned_workspace_id is not null and assigned_workspace_id <> new.workspace_id then
    raise exception 'Role belongs to a different workspace';
  end if;

  return new;
end;
$$;
create trigger workspace_membership_role_check
  before insert or update of workspace_id, role_id on public.workspace_memberships
  for each row execute procedure public.validate_workspace_membership_role();

create or replace function public.validate_platform_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.roles r where r.id = new.role_id and r.key = 'super_admin' and r.workspace_id is null) then
    raise exception 'Only the super_admin role can be assigned platform-wide';
  end if;
  return new;
end;
$$;
create trigger platform_role_check
  before insert or update of role_id on public.platform_roles
  for each row execute procedure public.validate_platform_role();

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.permissions enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.workspace_memberships enable row level security;
alter table public.platform_roles enable row level security;

create policy "Users can read their own profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "Users can update their own profile" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "Workspace members can read workspace details" on public.workspaces
  for select to authenticated using (public.has_permission('workspace.read', id));
create policy "Super admins can create workspaces" on public.workspaces
  for insert to authenticated with check (public.has_permission('workspace.manage', null));
create policy "Super admins can update workspaces" on public.workspaces
  for update to authenticated using (public.has_permission('workspace.manage', id)) with check (public.has_permission('workspace.manage', id));
create policy "Super admins can delete workspaces" on public.workspaces
  for delete to authenticated using (public.has_permission('workspace.manage', id));

create policy "Authenticated users can read permission catalog" on public.permissions
  for select to authenticated using (true);
create policy "Super admins can manage permission catalog" on public.permissions
  for all to authenticated using (public.has_permission('roles.manage', null)) with check (public.has_permission('roles.manage', null));

create policy "Users can read roles available in their workspace" on public.roles
  for select to authenticated using (
    workspace_id is null
    or public.has_permission('workspace.read', workspace_id)
  );
create policy "Super admins can create roles" on public.roles
  for insert to authenticated with check (public.has_permission('roles.manage', null));
create policy "Super admins can update roles" on public.roles
  for update to authenticated using (public.has_permission('roles.manage', null)) with check (public.has_permission('roles.manage', null));
create policy "Super admins can delete non-system roles" on public.roles
  for delete to authenticated using (not is_system and public.has_permission('roles.manage', null));

create policy "Workspace users can read role permissions" on public.role_permissions
  for select to authenticated using (
    exists (select 1 from public.roles r where r.id = role_id and
      (r.workspace_id is null or public.has_permission('workspace.read', r.workspace_id)))
  );
create policy "Super admins can manage role permissions" on public.role_permissions
  for all to authenticated using (public.has_permission('roles.manage', null)) with check (public.has_permission('roles.manage', null));

create policy "Users can read their own memberships" on public.workspace_memberships
  for select to authenticated using (
    user_id = (select auth.uid()) or public.has_permission('users.manage', workspace_id)
  );
create policy "Super admins can create memberships" on public.workspace_memberships
  for insert to authenticated with check (public.has_permission('users.manage', null));
create policy "Super admins can update memberships" on public.workspace_memberships
  for update to authenticated using (public.has_permission('users.manage', null)) with check (public.has_permission('users.manage', null));
create policy "Super admins can delete memberships" on public.workspace_memberships
  for delete to authenticated using (public.has_permission('users.manage', null));

create policy "Users can read their own platform roles" on public.platform_roles
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Super admins can grant platform roles" on public.platform_roles
  for insert to authenticated with check (public.has_permission('roles.manage', null));
create policy "Super admins can revoke platform roles" on public.platform_roles
  for delete to authenticated using (public.has_permission('roles.manage', null));

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.workspaces to authenticated;
grant select, insert, update, delete on public.permissions to authenticated;
grant select, insert, update, delete on public.roles to authenticated;
grant select, insert, update, delete on public.role_permissions to authenticated;
grant select, insert, update, delete on public.workspace_memberships to authenticated;
grant select, insert, delete on public.platform_roles to authenticated;
grant execute on function public.has_permission(text, uuid) to authenticated;
revoke all on function public.has_permission(text, uuid) from public, anon;
