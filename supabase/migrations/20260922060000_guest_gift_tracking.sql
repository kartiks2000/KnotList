-- Track welcome and final gift delivery per family.
alter table public.guest_groups
  add column if not exists welcome_gift_given boolean not null default false,
  add column if not exists final_gift_given boolean not null default false;

insert into public.permissions (key, description) values
  ('gifts.read', 'Read gift delivery status in an assigned workspace.'),
  ('gifts.manage', 'Update gift delivery status in an assigned workspace.')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.workspace_id is null
  and r.key = 'admin'
  and p.key in ('gifts.read', 'gifts.manage')
on conflict do nothing;

create or replace function public.update_workspace_gift_status(
  requested_workspace_id uuid,
  requested_guest_group_id uuid,
  requested_gift_type text,
  requested_given boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required' using errcode = '28000';
  end if;
  if not public.has_permission('gifts.manage', requested_workspace_id) then
    raise exception 'You do not have permission to update gifts in this workspace' using errcode = '42501';
  end if;

  if requested_gift_type = 'welcome' then
    update public.guest_groups
    set welcome_gift_given = requested_given,
        updated_by = auth.uid()
    where id = requested_guest_group_id
      and workspace_id = requested_workspace_id
      and archived_at is null;
  elsif requested_gift_type = 'final' then
    update public.guest_groups
    set final_gift_given = requested_given,
        updated_by = auth.uid()
    where id = requested_guest_group_id
      and workspace_id = requested_workspace_id
      and archived_at is null;
  else
    raise exception 'Unsupported gift type';
  end if;

  if not found then
    raise exception 'Family not found in this planning space' using errcode = 'P0002';
  end if;
  return true;
end;
$$;

revoke all on function public.update_workspace_gift_status(uuid, uuid, text, boolean) from public;
grant execute on function public.update_workspace_gift_status(uuid, uuid, text, boolean) to authenticated;
