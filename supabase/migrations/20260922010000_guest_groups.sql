-- Family/household guest records. All guest data is scoped to one workspace.
create table public.guest_groups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  family_name text not null check (length(trim(family_name)) between 1 and 140),
  contact_name text not null default '',
  phone text not null default '',
  expected_guests integer not null default 1 check (expected_guests between 1 and 500),
  invitation_sent boolean not null default false,
  invitation_sent_at timestamptz,
  invitation_call_made boolean not null default false,
  last_called_at timestamptz,
  rsvp_status text not null default 'pending'
    check (rsvp_status in ('pending', 'confirmed', 'maybe', 'declined')),
  rsvp_guest_count integer check (rsvp_guest_count is null or rsvp_guest_count between 0 and 500),
  check_in_at timestamptz,
  check_out_at timestamptz,
  expected_rooms integer check (expected_rooms is null or expected_rooms between 0 and 100),
  notes text not null default '',
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guest_groups_checkout_after_checkin
    check (check_in_at is null or check_out_at is null or check_out_at > check_in_at)
);

create index guest_groups_workspace_name_idx
  on public.guest_groups (workspace_id, lower(family_name))
  where archived_at is null;
create index guest_groups_workspace_rsvp_idx
  on public.guest_groups (workspace_id, rsvp_status)
  where archived_at is null;
create index guest_groups_workspace_arrival_idx
  on public.guest_groups (workspace_id, check_in_at)
  where archived_at is null;

create trigger guest_groups_set_updated_at
  before update on public.guest_groups
  for each row execute procedure public.set_updated_at();

alter table public.guest_groups enable row level security;

create policy "Workspace users can read guest groups"
  on public.guest_groups for select to authenticated
  using (archived_at is null and public.has_permission('app_data.read', workspace_id));
create policy "Workspace admins can add guest groups"
  on public.guest_groups for insert to authenticated
  with check (public.has_permission('app_data.manage', workspace_id));
create policy "Workspace admins can update guest groups"
  on public.guest_groups for update to authenticated
  using (public.has_permission('app_data.manage', workspace_id))
  with check (public.has_permission('app_data.manage', workspace_id));
create policy "Workspace admins can archive guest groups"
  on public.guest_groups for delete to authenticated
  using (public.has_permission('app_data.manage', workspace_id));

grant select, insert, update, delete on public.guest_groups to authenticated;
