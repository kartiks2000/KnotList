-- Keep removed guest records and their documents for recovery/audit, while
-- hiding them from normal reads and disabling their guest-specific RSVP links.

drop policy if exists "Workspace admins can archive guest groups" on public.guest_groups;
drop policy if exists "Workspace admins can update guest groups" on public.guest_groups;

create policy "Workspace admins can update active guest groups"
  on public.guest_groups for update to authenticated
  using (
    archived_at is null
    and public.has_permission('app_data.manage', workspace_id)
  )
  with check (
    archived_at is null
    and public.has_permission('app_data.manage', workspace_id)
  );

revoke delete on public.guest_groups from authenticated;

create or replace function public.archive_guest_group(
  requested_workspace_id uuid,
  requested_guest_group_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_rows integer;
begin
  if auth.uid() is null
    or not public.has_permission('app_data.manage', requested_workspace_id) then
    raise exception 'You cannot manage guests in this planning space' using errcode = '42501';
  end if;

  update public.guest_groups as guest
  set archived_at = coalesce(guest.archived_at, now())
  where guest.id = requested_guest_group_id
    and guest.workspace_id = requested_workspace_id
    and guest.archived_at is null;

  get diagnostics affected_rows = row_count;
  if affected_rows = 0 then
    return false;
  end if;

  update public.guest_public_rsvp_links as link
  set active = false
  where link.guest_group_id = requested_guest_group_id
    and link.workspace_id = requested_workspace_id
    and link.active;

  return true;
end;
$$;

revoke all on function public.archive_guest_group(uuid, uuid) from public, anon;
grant execute on function public.archive_guest_group(uuid, uuid) to authenticated;

-- Do not allow an archived guest's personal link to be reactivated.
create or replace function public.get_or_create_guest_rsvp_link(
  requested_workspace_id uuid,
  requested_guest_group_id uuid,
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
    raise exception 'You cannot manage RSVP links for this planning space' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.guest_groups as guest
    where guest.id = requested_guest_group_id
      and guest.workspace_id = requested_workspace_id
      and guest.archived_at is null
  ) then
    raise exception 'Guest entry not found' using errcode = '22023';
  end if;
  insert into public.guest_public_rsvp_links as existing_link
    (workspace_id, guest_group_id, token, active, created_by)
  values (
    requested_workspace_id, requested_guest_group_id,
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    true, auth.uid()
  )
  on conflict (guest_group_id) do update
    set token = case when rotate_link or not existing_link.active then excluded.token else existing_link.token end,
        active = true,
        created_by = case when rotate_link or not existing_link.active then auth.uid() else existing_link.created_by end,
        created_at = case when rotate_link or not existing_link.active then now() else existing_link.created_at end
  returning token into result_token;
  return result_token;
end;
$$;
revoke all on function public.get_or_create_guest_rsvp_link(uuid, uuid, boolean) from public, anon;
grant execute on function public.get_or_create_guest_rsvp_link(uuid, uuid, boolean) to authenticated;

-- Protect against stale or manually reactivated tokens at submission time.
create or replace function public.submit_public_workspace_rsvp_once(
  requested_token text,
  requested_form_data jsonb
)
returns table (workspace_name text, workspace_id uuid, guest_group_id uuid, notification_event_id uuid, guest_count integer, rsvp_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_active boolean;
  matched_submitted_at timestamptz;
  personal_link_found boolean := false;
  submitted_row record;
begin
  select link.active, link.submitted_at
    into matched_active, matched_submitted_at
  from public.guest_public_rsvp_links as link
  where link.token = requested_token
  for update;
  personal_link_found := found;

  if personal_link_found then
    if not exists (
      select 1 from public.guest_public_rsvp_links as link
      join public.guest_groups as guest
        on guest.id = link.guest_group_id
        and guest.workspace_id = link.workspace_id
      where link.token = requested_token
        and guest.archived_at is null
    ) then
      raise exception 'This RSVP link is invalid or has been turned off' using errcode = '22023';
    end if;
    if matched_submitted_at is not null then
      raise exception 'This RSVP has already been submitted' using errcode = '22023';
    end if;
    if not matched_active then
      raise exception 'This RSVP link is invalid or has been turned off' using errcode = '22023';
    end if;

    select * into submitted_row
    from public.submit_public_workspace_rsvp(requested_token, requested_form_data);

    update public.guest_groups as guest
    set self_rsvp = true
    where guest.id = submitted_row.guest_group_id
      and guest.workspace_id = submitted_row.workspace_id
      and guest.archived_at is null;

    update public.guest_public_rsvp_links as link
    set active = false, submitted_at = now()
    where link.token = requested_token;
    workspace_name := submitted_row.workspace_name;
    workspace_id := submitted_row.workspace_id;
    guest_group_id := submitted_row.guest_group_id;
    notification_event_id := submitted_row.notification_event_id;
    guest_count := submitted_row.guest_count;
    rsvp_status := submitted_row.rsvp_status;
    return next;
    return;
  end if;

  return query
    select * from public.submit_public_workspace_rsvp(requested_token, requested_form_data);
end;
$$;

-- Archived guests' personal links should no longer resolve, including links
-- that had already been submitted before the guest was archived.
drop function if exists public.get_public_workspace_rsvp_form(text);
create function public.get_public_workspace_rsvp_form(requested_token text)
returns table (workspace_name text, settings jsonb, guest_group_id uuid, already_submitted boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select w.name,
    case when s.settings is null then '{
      "title":"You’re invited",
      "intro":"We’d love to know if you can join us.",
      "askGuestCount":true,
      "askCheckinDate":true,
      "checkinOptions":[{"date":"2027-02-19","label":"19 Feb 2027"},{"date":"2027-02-20","label":"20 Feb 2027"}],
      "askCheckoutDate":false,
      "checkoutOptions":[],
      "yesLabel":"Yes, we’ll be there",
      "noLabel":"No, we can’t make it",
      "customQuestions":[]
    }'::jsonb
    when s.settings ? 'customQuestions' then s.settings
    else s.settings || '{"customQuestions":[]}'::jsonb end,
    targets.guest_group_id,
    targets.already_submitted
  from (
    select link.workspace_id, null::uuid as guest_group_id, false as already_submitted
    from public.workspace_public_rsvp_links as link
    where link.token = requested_token and link.active
    union all
    select link.workspace_id, link.guest_group_id, link.submitted_at is not null
    from public.guest_public_rsvp_links as link
    join public.guest_groups as guest
      on guest.id = link.guest_group_id
      and guest.workspace_id = link.workspace_id
      and guest.archived_at is null
    where link.token = requested_token
      and (link.active or link.submitted_at is not null)
  ) as targets
  join public.workspaces as w on w.id = targets.workspace_id
  left join public.workspace_public_rsvp_settings as s on s.workspace_id = targets.workspace_id;
$$;
revoke all on function public.get_public_workspace_rsvp_form(text) from public, anon, authenticated;
grant execute on function public.get_public_workspace_rsvp_form(text) to service_role;

drop function if exists public.get_public_workspace_rsvp(text);
create function public.get_public_workspace_rsvp(requested_token text)
returns table (workspace_name text, workspace_id uuid, guest_group_id uuid, already_submitted boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select w.name, targets.workspace_id, targets.guest_group_id, targets.already_submitted
  from (
    select link.workspace_id, null::uuid as guest_group_id, false as already_submitted
    from public.workspace_public_rsvp_links as link
    where link.token = requested_token and link.active
    union all
    select link.workspace_id, link.guest_group_id, link.submitted_at is not null
    from public.guest_public_rsvp_links as link
    join public.guest_groups as guest
      on guest.id = link.guest_group_id
      and guest.workspace_id = link.workspace_id
      and guest.archived_at is null
    where link.token = requested_token
      and (link.active or link.submitted_at is not null)
  ) as targets
  join public.workspaces as w on w.id = targets.workspace_id;
$$;
revoke all on function public.get_public_workspace_rsvp(text) from public, anon, authenticated;
grant execute on function public.get_public_workspace_rsvp(text) to service_role;
