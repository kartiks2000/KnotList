-- Let each planning space configure the questions on its shared RSVP form.
alter table public.guest_groups
  drop constraint if exists guest_groups_public_rsvp_checkin_date_check,
  add column if not exists public_rsvp_checkout_date date;

create table if not exists public.workspace_public_rsvp_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  settings jsonb not null default '{
    "title":"You’re invited",
    "intro":"We’d love to know if you can join us.",
    "askGuestCount":true,
    "askCheckinDate":true,
    "checkinOptions":[{"date":"2027-02-19","label":"19 Feb 2027"},{"date":"2027-02-20","label":"20 Feb 2027"}],
    "askCheckoutDate":false,
    "checkoutOptions":[],
    "yesLabel":"Yes, we’ll be there",
    "noLabel":"No, we can’t make it"
  }'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.workspace_public_rsvp_settings enable row level security;
revoke all on public.workspace_public_rsvp_settings from public, anon, authenticated;

create or replace function public.get_workspace_public_rsvp_settings(requested_workspace_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not public.has_permission('app_data.manage', requested_workspace_id) then
    raise exception 'You cannot manage RSVP settings for this planning space' using errcode = '42501';
  end if;
  select s.settings into result
  from public.workspace_public_rsvp_settings s
  where s.workspace_id = requested_workspace_id;
  return coalesce(result, '{
    "title":"You’re invited",
    "intro":"We’d love to know if you can join us.",
    "askGuestCount":true,
    "askCheckinDate":true,
    "checkinOptions":[{"date":"2027-02-19","label":"19 Feb 2027"},{"date":"2027-02-20","label":"20 Feb 2027"}],
    "askCheckoutDate":false,
    "checkoutOptions":[],
    "yesLabel":"Yes, we’ll be there",
    "noLabel":"No, we can’t make it"
  }'::jsonb);
end;
$$;
revoke all on function public.get_workspace_public_rsvp_settings(uuid) from public, anon;
grant execute on function public.get_workspace_public_rsvp_settings(uuid) to authenticated;

create or replace function public.save_workspace_public_rsvp_settings(
  requested_workspace_id uuid,
  requested_settings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_settings jsonb;
  option_list jsonb;
  option_item jsonb;
  option_date date;
  option_dates text[];
  option_key text;
begin
  if auth.uid() is null or not public.has_permission('app_data.manage', requested_workspace_id) then
    raise exception 'You cannot manage RSVP settings for this planning space' using errcode = '42501';
  end if;
  if jsonb_typeof(requested_settings) <> 'object' then
    raise exception 'Invalid RSVP settings' using errcode = '22023';
  end if;
  if length(trim(coalesce(requested_settings->>'title', ''))) not between 1 and 80
     or length(coalesce(requested_settings->>'intro', '')) > 280
     or length(trim(coalesce(requested_settings->>'yesLabel', ''))) not between 1 and 80
     or length(trim(coalesce(requested_settings->>'noLabel', ''))) not between 1 and 80 then
    raise exception 'Check the title, message, and response labels' using errcode = '22023';
  end if;
  if jsonb_typeof(requested_settings->'askGuestCount') is distinct from 'boolean'
     or jsonb_typeof(requested_settings->'askCheckinDate') is distinct from 'boolean'
     or jsonb_typeof(requested_settings->'askCheckoutDate') is distinct from 'boolean' then
    raise exception 'Invalid RSVP question settings' using errcode = '22023';
  end if;

  foreach option_key in array array['checkinOptions', 'checkoutOptions'] loop
    option_list := requested_settings->option_key;
    if option_list is null or jsonb_typeof(option_list) <> 'array' or jsonb_array_length(option_list) > 20 then
      raise exception 'Date choices must be a list of at most 20 options' using errcode = '22023';
    end if;
    if (option_key = 'checkinOptions' and (requested_settings->>'askCheckinDate')::boolean)
       or (option_key = 'checkoutOptions' and (requested_settings->>'askCheckoutDate')::boolean) then
      if jsonb_array_length(option_list) = 0 then
        raise exception 'Add at least one date choice for each enabled date question' using errcode = '22023';
      end if;
    end if;
    option_dates := array[]::text[];
    for option_item in select value from jsonb_array_elements(option_list) loop
      if coalesce(option_item->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'Every date choice needs a valid date' using errcode = '22023';
      end if;
      option_date := (option_item->>'date')::date;
      if option_date::text <> option_item->>'date' then
        raise exception 'Every date choice needs a valid date' using errcode = '22023';
      end if;
      if length(coalesce(option_item->>'label', '')) > 80 then
        raise exception 'Date choice labels must be 80 characters or fewer' using errcode = '22023';
      end if;
      option_dates := array_append(option_dates, option_date::text);
    end loop;
    if cardinality(option_dates) <> (select count(distinct d) from unnest(option_dates) as dates(d)) then
      raise exception 'Remove duplicate dates from the choices' using errcode = '22023';
    end if;
  end loop;

  clean_settings := jsonb_build_object(
    'title', trim(requested_settings->>'title'),
    'intro', coalesce(requested_settings->>'intro', ''),
    'askGuestCount', (requested_settings->>'askGuestCount')::boolean,
    'askCheckinDate', (requested_settings->>'askCheckinDate')::boolean,
    'checkinOptions', requested_settings->'checkinOptions',
    'askCheckoutDate', (requested_settings->>'askCheckoutDate')::boolean,
    'checkoutOptions', requested_settings->'checkoutOptions',
    'yesLabel', trim(requested_settings->>'yesLabel'),
    'noLabel', trim(requested_settings->>'noLabel')
  );
  insert into public.workspace_public_rsvp_settings as current_settings (workspace_id, settings, updated_by, updated_at)
  values (requested_workspace_id, clean_settings, auth.uid(), now())
  on conflict (workspace_id) do update
  set settings = excluded.settings, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return clean_settings;
end;
$$;
revoke all on function public.save_workspace_public_rsvp_settings(uuid, jsonb) from public, anon;
grant execute on function public.save_workspace_public_rsvp_settings(uuid, jsonb) to authenticated;

create or replace function public.get_public_workspace_rsvp_form(requested_token text)
returns table (workspace_name text, settings jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select w.name, coalesce(s.settings, '{
    "title":"You’re invited",
    "intro":"We’d love to know if you can join us.",
    "askGuestCount":true,
    "askCheckinDate":true,
    "checkinOptions":[{"date":"2027-02-19","label":"19 Feb 2027"},{"date":"2027-02-20","label":"20 Feb 2027"}],
    "askCheckoutDate":false,
    "checkoutOptions":[],
    "yesLabel":"Yes, we’ll be there",
    "noLabel":"No, we can’t make it"
  }'::jsonb)
  from public.workspace_public_rsvp_links l
  join public.workspaces w on w.id = l.workspace_id
  left join public.workspace_public_rsvp_settings s on s.workspace_id = l.workspace_id
  where l.token = requested_token and l.active;
$$;
revoke all on function public.get_public_workspace_rsvp_form(text) from public, anon, authenticated;
grant execute on function public.get_public_workspace_rsvp_form(text) to service_role;

drop function if exists public.submit_public_workspace_rsvp(text, text, integer, text, date);
create function public.submit_public_workspace_rsvp(requested_token text, requested_form_data jsonb)
returns table (workspace_name text, workspace_id uuid, guest_group_id uuid, notification_event_id uuid, guest_count integer, rsvp_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_workspace_id uuid;
  matched_workspace_name text;
  form_settings jsonb;
  clean_name text;
  submitted_count integer;
  submitted_rsvp text;
  submitted_checkin date;
  submitted_checkout date;
  inserted_guest_group_id uuid;
  inserted_notification_event_id uuid;
begin
  if jsonb_typeof(requested_form_data) <> 'object' then
    raise exception 'Submit a valid RSVP form' using errcode = '22023';
  end if;
  select w.id, w.name into matched_workspace_id, matched_workspace_name
  from public.workspace_public_rsvp_links l
  join public.workspaces w on w.id = l.workspace_id
  where l.token = requested_token and l.active;
  if matched_workspace_id is null then
    raise exception 'This RSVP link is invalid or has been turned off' using errcode = '22023';
  end if;

  select s.settings into form_settings from public.workspace_public_rsvp_settings s
  where s.workspace_id = matched_workspace_id;
  form_settings := coalesce(form_settings, '{
    "askGuestCount":true,
    "askCheckinDate":true,
    "checkinOptions":[{"date":"2027-02-19","label":"19 Feb 2027"},{"date":"2027-02-20","label":"20 Feb 2027"}],
    "askCheckoutDate":false,
    "checkoutOptions":[]
  }'::jsonb);

  clean_name := trim(coalesce(requested_form_data->>'name', ''));
  submitted_rsvp := requested_form_data->>'rsvp';
  if length(clean_name) not between 1 and 140 then
    raise exception 'Enter a name between 1 and 140 characters' using errcode = '22023';
  end if;
  if submitted_rsvp not in ('confirmed', 'declined') then
    raise exception 'Choose Yes or No for your RSVP' using errcode = '22023';
  end if;
  if (form_settings->>'askGuestCount')::boolean then
    if coalesce(requested_form_data->>'guestCount', '') !~ '^\d{1,3}$' then
      raise exception 'Enter a valid number of people' using errcode = '22023';
    end if;
    submitted_count := (requested_form_data->>'guestCount')::integer;
    if submitted_count not between 1 and 500 then
      raise exception 'Number of people must be between 1 and 500' using errcode = '22023';
    end if;
  else
    submitted_count := 1;
  end if;

  if submitted_rsvp = 'confirmed' and (form_settings->>'askCheckinDate')::boolean then
    if coalesce(requested_form_data->>'checkinDate', '') !~ '^\d{4}-\d{2}-\d{2}$'
       or not exists (select 1 from jsonb_array_elements(form_settings->'checkinOptions') opt where opt->>'date' = requested_form_data->>'checkinDate') then
      raise exception 'Choose one of the available check-in dates' using errcode = '22023';
    end if;
    submitted_checkin := (requested_form_data->>'checkinDate')::date;
  end if;
  if submitted_rsvp = 'confirmed' and (form_settings->>'askCheckoutDate')::boolean then
    if coalesce(requested_form_data->>'checkoutDate', '') !~ '^\d{4}-\d{2}-\d{2}$'
       or not exists (select 1 from jsonb_array_elements(form_settings->'checkoutOptions') opt where opt->>'date' = requested_form_data->>'checkoutDate') then
      raise exception 'Choose one of the available check-out dates' using errcode = '22023';
    end if;
    submitted_checkout := (requested_form_data->>'checkoutDate')::date;
  end if;

  insert into public.guest_groups (
    workspace_id, family_name, contact_name, guest_count, invitation_sent,
    invitation_sent_at, rsvp_status, public_rsvp_checkin_date, public_rsvp_checkout_date, self_rsvp
  ) values (
    matched_workspace_id, clean_name, '', submitted_count, true, now(), submitted_rsvp,
    case when submitted_rsvp = 'confirmed' then submitted_checkin else null end,
    case when submitted_rsvp = 'confirmed' then submitted_checkout else null end,
    true
  ) returning id into inserted_guest_group_id;

  insert into public.lodging_notification_events
    (actor_user_id, workspace_id, guest_group_id, event_type, guest_name)
  values (
    null, matched_workspace_id, inserted_guest_group_id,
    case when submitted_rsvp = 'confirmed' then 'rsvp_confirmed' else 'rsvp_declined' end,
    clean_name
  ) returning id into inserted_notification_event_id;

  update public.guest_groups
  set last_rsvp_notification_event_id = inserted_notification_event_id
  where guest_groups.id = inserted_guest_group_id;

  insert into public.workspace_notifications
    (user_id, workspace_id, guest_group_id, event_type, guest_name, event_id)
  select recipients.user_id, matched_workspace_id, inserted_guest_group_id,
    case when submitted_rsvp = 'confirmed' then 'rsvp_confirmed' else 'rsvp_declined' end,
    clean_name, inserted_notification_event_id
  from public.get_workspace_rsvp_notification_recipient_ids(matched_workspace_id) recipients;

  return query select matched_workspace_name, matched_workspace_id, inserted_guest_group_id,
    inserted_notification_event_id, submitted_count, submitted_rsvp;
end;
$$;
revoke all on function public.submit_public_workspace_rsvp(text, jsonb) from public, anon, authenticated;
grant execute on function public.submit_public_workspace_rsvp(text, jsonb) to service_role;
