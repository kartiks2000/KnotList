-- Consume a personal RSVP link after its first successful submission while
-- keeping the shared planning-space RSVP link reusable.
alter table public.guest_public_rsvp_links
  add column if not exists submitted_at timestamptz;

drop function public.get_public_workspace_rsvp_form(text);
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
    select l.workspace_id, null::uuid as guest_group_id, false as already_submitted
    from public.workspace_public_rsvp_links l
    where l.token = requested_token and l.active
    union all
    select l.workspace_id, l.guest_group_id, l.submitted_at is not null
    from public.guest_public_rsvp_links l
    where l.token = requested_token and (l.active or l.submitted_at is not null)
  ) targets
  join public.workspaces w on w.id = targets.workspace_id
  left join public.workspace_public_rsvp_settings s on s.workspace_id = targets.workspace_id;
$$;
revoke all on function public.get_public_workspace_rsvp_form(text) from public, anon, authenticated;
grant execute on function public.get_public_workspace_rsvp_form(text) to service_role;

drop function public.get_public_workspace_rsvp(text);
create function public.get_public_workspace_rsvp(requested_token text)
returns table (workspace_name text, workspace_id uuid, guest_group_id uuid, already_submitted boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select w.name, targets.workspace_id, targets.guest_group_id, targets.already_submitted
  from (
    select l.workspace_id, null::uuid as guest_group_id, false as already_submitted
    from public.workspace_public_rsvp_links l
    where l.token = requested_token and l.active
    union all
    select l.workspace_id, l.guest_group_id, l.submitted_at is not null
    from public.guest_public_rsvp_links l
    where l.token = requested_token and (l.active or l.submitted_at is not null)
  ) targets
  join public.workspaces w on w.id = targets.workspace_id;
$$;
revoke all on function public.get_public_workspace_rsvp(text) from public, anon, authenticated;
grant execute on function public.get_public_workspace_rsvp(text) to service_role;

-- Serialize personal-link submissions. The existing submission function and
-- link consumption happen in the same transaction, preventing repeat replies.
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
  select l.active, l.submitted_at
    into matched_active, matched_submitted_at
  from public.guest_public_rsvp_links l
  where l.token = requested_token
  for update;
  personal_link_found := found;

  if personal_link_found then
    if matched_submitted_at is not null then
      raise exception 'This RSVP has already been submitted' using errcode = '22023';
    end if;
    if not matched_active then
      raise exception 'This RSVP link is invalid or has been turned off' using errcode = '22023';
    end if;

    select * into submitted_row
    from public.submit_public_workspace_rsvp(requested_token, requested_form_data);

    update public.guest_groups
    set self_rsvp = true
    where guest_groups.id = submitted_row.guest_group_id
      and guest_groups.workspace_id = submitted_row.workspace_id;

    update public.guest_public_rsvp_links
    set active = false, submitted_at = now()
    where token = requested_token;
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
revoke all on function public.submit_public_workspace_rsvp_once(text, jsonb) from public, anon, authenticated;
grant execute on function public.submit_public_workspace_rsvp_once(text, jsonb) to service_role;
