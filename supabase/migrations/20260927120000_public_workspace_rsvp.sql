-- Shared, public RSVP links scoped to an individual planning space.
alter table public.guest_groups
  add column if not exists self_rsvp boolean not null default false,
  add column if not exists public_rsvp_checkin_date date
    check (public_rsvp_checkin_date is null or public_rsvp_checkin_date in (date '2027-02-19', date '2027-02-20'));

create table if not exists public.workspace_public_rsvp_links (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  token text not null unique,
  active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.workspace_public_rsvp_links enable row level security;
revoke all on public.workspace_public_rsvp_links from public, anon, authenticated;

create or replace function public.get_or_create_workspace_rsvp_link(
  requested_workspace_id uuid,
  rotate_link boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_token text;
begin
  if auth.uid() is null or not public.has_permission('app_data.manage', requested_workspace_id) then
    raise exception 'You cannot manage the RSVP link for this planning space' using errcode = '42501';
  end if;

  insert into public.workspace_public_rsvp_links as existing_link
    (workspace_id, token, active, created_by)
  values (
    requested_workspace_id,
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    true,
    auth.uid()
  )
  on conflict (workspace_id) do update
    set token = case when rotate_link or not existing_link.active then excluded.token else existing_link.token end,
        active = true,
        created_by = case when rotate_link or not existing_link.active then auth.uid() else existing_link.created_by end,
        created_at = case when rotate_link or not existing_link.active then now() else existing_link.created_at end
  returning token into result_token;

  return result_token;
end;
$$;
revoke all on function public.get_or_create_workspace_rsvp_link(uuid, boolean) from public, anon;
grant execute on function public.get_or_create_workspace_rsvp_link(uuid, boolean) to authenticated;

create or replace function public.revoke_workspace_rsvp_link(requested_workspace_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_permission('app_data.manage', requested_workspace_id) then
    raise exception 'You cannot manage the RSVP link for this planning space' using errcode = '42501';
  end if;
  update public.workspace_public_rsvp_links set active = false
  where workspace_id = requested_workspace_id;
  return found;
end;
$$;
revoke all on function public.revoke_workspace_rsvp_link(uuid) from public, anon;
grant execute on function public.revoke_workspace_rsvp_link(uuid) to authenticated;

create or replace function public.get_public_workspace_rsvp(requested_token text)
returns table (workspace_name text, workspace_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select w.name, w.id
  from public.workspace_public_rsvp_links l
  join public.workspaces w on w.id = l.workspace_id
  where l.token = requested_token and l.active;
$$;
revoke all on function public.get_public_workspace_rsvp(text) from public, anon, authenticated;
grant execute on function public.get_public_workspace_rsvp(text) to service_role;

create or replace function public.submit_public_workspace_rsvp(
  requested_token text,
  requested_name text,
  requested_guest_count integer,
  requested_rsvp_status text,
  requested_checkin_date date default null
)
returns table (workspace_name text, workspace_id uuid, guest_group_id uuid, notification_event_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_workspace_id uuid;
  matched_workspace_name text;
  inserted_guest_group_id uuid;
  inserted_notification_event_id uuid;
begin
  if length(trim(coalesce(requested_name, ''))) not between 1 and 140 then
    raise exception 'Enter a name between 1 and 140 characters' using errcode = '22023';
  end if;
  if requested_guest_count is null or requested_guest_count not between 1 and 500 then
    raise exception 'Number of people must be between 1 and 500' using errcode = '22023';
  end if;
  if requested_rsvp_status not in ('confirmed', 'declined') then
    raise exception 'Choose Yes or No for your RSVP' using errcode = '22023';
  end if;
  if requested_rsvp_status = 'confirmed'
     and requested_checkin_date not in (date '2027-02-19', date '2027-02-20') then
    raise exception 'Choose one of the available check-in dates' using errcode = '22023';
  end if;
  if requested_rsvp_status = 'declined' and requested_checkin_date is not null then
    raise exception 'A declined RSVP cannot have a check-in date' using errcode = '22023';
  end if;

  select l.workspace_id, w.name into matched_workspace_id, matched_workspace_name
  from public.workspace_public_rsvp_links l
  join public.workspaces w on w.id = l.workspace_id
  where l.token = requested_token and l.active;
  if matched_workspace_id is null then
    raise exception 'This RSVP link is invalid or has been turned off' using errcode = '22023';
  end if;

  insert into public.guest_groups (
    workspace_id, family_name, contact_name, guest_count, invitation_sent,
    invitation_sent_at, rsvp_status, public_rsvp_checkin_date, self_rsvp
  ) values (
    matched_workspace_id, trim(requested_name), '', requested_guest_count,
    true, now(), requested_rsvp_status,
    case when requested_rsvp_status = 'confirmed' then requested_checkin_date else null end,
    true
  ) returning id into inserted_guest_group_id;

  insert into public.lodging_notification_events
    (actor_user_id, workspace_id, guest_group_id, event_type, guest_name)
  values (
    null, matched_workspace_id, inserted_guest_group_id,
    case when requested_rsvp_status = 'confirmed' then 'rsvp_confirmed' else 'rsvp_declined' end,
    trim(requested_name)
  ) returning id into inserted_notification_event_id;

  update public.guest_groups
  set last_rsvp_notification_event_id = inserted_notification_event_id
  where id = inserted_guest_group_id;

  insert into public.workspace_notifications
    (user_id, workspace_id, guest_group_id, event_type, guest_name, event_id)
  select recipients.user_id, matched_workspace_id, inserted_guest_group_id,
    case when requested_rsvp_status = 'confirmed' then 'rsvp_confirmed' else 'rsvp_declined' end,
    trim(requested_name), inserted_notification_event_id
  from public.get_workspace_rsvp_notification_recipient_ids(matched_workspace_id) recipients;

  return query select matched_workspace_name, matched_workspace_id, inserted_guest_group_id, inserted_notification_event_id;
end;
$$;
revoke all on function public.submit_public_workspace_rsvp(text, text, integer, text, date) from public, anon, authenticated;
grant execute on function public.submit_public_workspace_rsvp(text, text, integer, text, date) to service_role;
