-- Give workspace hotel staff a role that can only access lodging data.
-- Lodging reads and writes go through narrow RPCs so the guest table's
-- contact, invitation, RSVP, and notes columns are never exposed to this role.

alter table public.roles
  add column workspace_assignable boolean not null default false;

update public.roles
set workspace_assignable = true
where workspace_id is null and key = 'admin';

insert into public.permissions (key, description) values
  ('lodging.read', 'Read guest counts and lodging assignments in an assigned workspace.'),
  ('lodging.manage', 'Update guest counts and lodging assignments in an assigned workspace.'),
  ('lodging.members.manage', 'Invite lodging users to an assigned workspace.')
on conflict (key) do nothing;

insert into public.roles (workspace_id, key, name, description, is_system, workspace_assignable)
values (null, 'lodging_manager', 'Lodging', 'Manage guest counts and room assignments in assigned workspaces.', true, true)
on conflict (key) where workspace_id is null
do update set name = excluded.name,
              description = excluded.description,
              is_system = true,
              workspace_assignable = true;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.workspace_id is null
  and r.key = 'admin'
  and p.key in (
    'workspace.read',
    'app_data.read',
    'app_data.manage',
    'lodging.read',
    'lodging.manage',
    'lodging.members.manage'
  )
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.workspace_id is null
  and r.key = 'lodging_manager'
  and p.key in ('workspace.read', 'lodging.read', 'lodging.manage')
on conflict do nothing;

create or replace function public.validate_workspace_membership_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  assigned_workspace_id uuid;
  assigned_role_key text;
  role_is_workspace_assignable boolean;
begin
  select r.workspace_id, r.key, r.workspace_assignable
    into assigned_workspace_id, assigned_role_key, role_is_workspace_assignable
  from public.roles r
  where r.id = new.role_id;

  if not found or assigned_role_key = 'super_admin' then
    raise exception 'Invalid workspace role';
  end if;

  if assigned_workspace_id is null and not role_is_workspace_assignable then
    raise exception 'This global role cannot be assigned to a workspace';
  end if;

  if assigned_workspace_id is not null and assigned_workspace_id <> new.workspace_id then
    raise exception 'Role belongs to a different workspace';
  end if;

  return new;
end;
$$;

create policy "Workspace access managers can read assigned memberships"
  on public.workspace_memberships for select to authenticated
  using (public.has_permission('lodging.members.manage', workspace_id));

create policy "Lodging access managers can read member profiles"
  on public.profiles for select to authenticated
  using (
    exists (
      select 1
      from public.workspace_memberships wm
      where wm.user_id = profiles.id
        and public.has_permission('lodging.members.manage', wm.workspace_id)
    )
  );

create or replace function public.get_workspace_lodging(requested_workspace_id uuid)
returns table (
  id uuid,
  workspace_id uuid,
  family_name text,
  guest_count integer,
  room_count integer,
  assigned_room_numbers text[]
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
  select g.id, g.workspace_id, g.family_name, g.guest_count, g.room_count, g.assigned_room_numbers
  from public.guest_groups g
  where g.workspace_id = requested_workspace_id
    and g.archived_at is null
  order by lower(g.family_name);
end;
$$;

create or replace function public.update_workspace_lodging(
  requested_workspace_id uuid,
  requested_guest_group_id uuid,
  requested_guest_count integer,
  requested_room_count integer,
  requested_room_numbers text[]
)
returns table (
  id uuid,
  workspace_id uuid,
  family_name text,
  guest_count integer,
  room_count integer,
  assigned_room_numbers text[]
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

  return query
  update public.guest_groups g
  set guest_count = requested_guest_count,
      room_count = requested_room_count,
      assigned_room_numbers = coalesce(requested_room_numbers, '{}'::text[]),
      updated_by = auth.uid()
  where g.id = requested_guest_group_id
    and g.workspace_id = requested_workspace_id
    and g.archived_at is null
  returning g.id, g.workspace_id, g.family_name, g.guest_count, g.room_count, g.assigned_room_numbers;

  if not found then
    raise exception 'Guest family not found in this workspace' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.get_workspace_lodging(uuid) from public, anon;
revoke all on function public.update_workspace_lodging(uuid, uuid, integer, integer, text[]) from public, anon;
grant execute on function public.get_workspace_lodging(uuid) to authenticated;
grant execute on function public.update_workspace_lodging(uuid, uuid, integer, integer, text[]) to authenticated;
