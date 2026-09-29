-- Allow planning-space admins to manage membership within their own space.
-- Workspace admins can assign Admin or Lodging access and remove Lodging
-- memberships. Platform super admins retain their existing global controls.

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
join public.permissions p on p.key in ('users.manage', 'lodging.members.manage')
where r.workspace_id is null
  and r.key = 'admin'
on conflict do nothing;

create policy "Workspace admins can create memberships"
  on public.workspace_memberships for insert to authenticated
  with check (public.has_permission('users.manage', workspace_id));

create policy "Workspace admins can update memberships"
  on public.workspace_memberships for update to authenticated
  using (public.has_permission('users.manage', workspace_id))
  with check (public.has_permission('users.manage', workspace_id));

drop policy if exists "Super admins can delete memberships" on public.workspace_memberships;

create policy "Super admins can delete any membership"
  on public.workspace_memberships for delete to authenticated
  using (public.has_permission('users.manage', null));

create policy "Workspace admins can remove lodging memberships"
  on public.workspace_memberships for delete to authenticated
  using (
    public.has_permission('users.manage', workspace_id)
    and exists (
      select 1
      from public.roles r
      where r.id = workspace_memberships.role_id
        and r.key = 'lodging_manager'
    )
  );
