-- Issue a unique public RSVP token for each existing guest entry.
create table public.guest_public_rsvp_links (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  guest_group_id uuid primary key,
  token text not null unique check (token ~ '^[a-f0-9]{64}$'),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint guest_public_rsvp_links_guest_workspace_fk
    foreign key (guest_group_id, workspace_id)
    references public.guest_groups(id, workspace_id) on delete cascade
);
alter table public.guest_public_rsvp_links enable row level security;
revoke all on public.guest_public_rsvp_links from public, anon, authenticated;

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
  if not exists (select 1 from public.guest_groups g where g.id = requested_guest_group_id and g.workspace_id = requested_workspace_id) then
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

-- Let both shared-space and guest-specific tokens load the same configured form.
drop function public.get_public_workspace_rsvp_form(text);
create function public.get_public_workspace_rsvp_form(requested_token text)
returns table (workspace_name text, settings jsonb, guest_group_id uuid)
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
    targets.guest_group_id
  from (
    select l.workspace_id, null::uuid as guest_group_id from public.workspace_public_rsvp_links l where l.token = requested_token and l.active
    union all
    select l.workspace_id, l.guest_group_id from public.guest_public_rsvp_links l where l.token = requested_token and l.active
  ) targets
  join public.workspaces w on w.id = targets.workspace_id
  left join public.workspace_public_rsvp_settings s on s.workspace_id = targets.workspace_id;
$$;
revoke all on function public.get_public_workspace_rsvp_form(text) from public, anon, authenticated;
grant execute on function public.get_public_workspace_rsvp_form(text) to service_role;

drop function public.get_public_workspace_rsvp(text);
create function public.get_public_workspace_rsvp(requested_token text)
returns table (workspace_name text, workspace_id uuid, guest_group_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select w.name, targets.workspace_id, targets.guest_group_id
  from (
    select l.workspace_id, null::uuid as guest_group_id from public.workspace_public_rsvp_links l where l.token = requested_token and l.active
    union all
    select l.workspace_id, l.guest_group_id from public.guest_public_rsvp_links l where l.token = requested_token and l.active
  ) targets
  join public.workspaces w on w.id = targets.workspace_id;
$$;
revoke all on function public.get_public_workspace_rsvp(text) from public, anon, authenticated;
grant execute on function public.get_public_workspace_rsvp(text) to service_role;

create or replace function public.submit_public_workspace_rsvp(requested_token text, requested_form_data jsonb)
returns table (workspace_name text, workspace_id uuid, guest_group_id uuid, notification_event_id uuid, guest_count integer, rsvp_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_workspace_id uuid;
  matched_workspace_name text;
  matched_guest_group_id uuid;
  form_settings jsonb;
  clean_name text;
  submitted_count integer;
  submitted_rsvp text;
  submitted_checkin date;
  submitted_checkout date;
  submitted_custom_answers jsonb;
  clean_custom_answers jsonb := '{}'::jsonb;
  question jsonb;
  question_id text;
  question_label text;
  question_type text;
  question_answer text;
  answer_key text;
  inserted_guest_group_id uuid;
  identification_document jsonb;
  identification_path text;
  identification_name text;
  identification_mime text;
  identification_size bigint;
  inserted_notification_event_id uuid;
begin
  if jsonb_typeof(requested_form_data) <> 'object' then
    raise exception 'Submit a valid RSVP form' using errcode = '22023';
  end if;
  select l.workspace_id, w.name, l.guest_group_id
  into matched_workspace_id, matched_workspace_name, matched_guest_group_id
  from public.guest_public_rsvp_links l
  join public.workspaces w on w.id = l.workspace_id
  where l.token = requested_token and l.active;
  if matched_workspace_id is null then
    select l.workspace_id, w.name, null::uuid
    into matched_workspace_id, matched_workspace_name, matched_guest_group_id
    from public.workspace_public_rsvp_links l
    join public.workspaces w on w.id = l.workspace_id
    where l.token = requested_token and l.active;
  end if;
  if matched_workspace_id is null then
    raise exception 'This RSVP link is invalid or has been turned off' using errcode = '22023';
  end if;

  select case when s.settings ? 'customQuestions' then s.settings
    else s.settings || '{"customQuestions":[]}'::jsonb end
  into form_settings
  from public.workspace_public_rsvp_settings s
  where s.workspace_id = matched_workspace_id;
  form_settings := coalesce(form_settings, '{
    "askGuestCount":true,
    "askCheckinDate":true,
    "checkinOptions":[{"date":"2027-02-19","label":"19 Feb 2027"},{"date":"2027-02-20","label":"20 Feb 2027"}],
    "askCheckoutDate":false,
    "checkoutOptions":[],
    "customQuestions":[]
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

  identification_document := requested_form_data->'identificationDocument';
  if submitted_rsvp = 'confirmed' and coalesce((form_settings->>'requireIdentificationDocument')::boolean, false)
     and identification_document is null then
    raise exception 'Upload an identification document to submit this RSVP' using errcode = '22023';
  end if;
  if identification_document is not null then
    if submitted_rsvp <> 'confirmed' or not coalesce((form_settings->>'askIdentificationDocument')::boolean, false)
       or jsonb_typeof(identification_document) <> 'object' then
      raise exception 'An identification document is not expected for this response' using errcode = '22023';
    end if;
    identification_path := identification_document->>'storagePath';
    identification_name := identification_document->>'fileName';
    identification_mime := identification_document->>'mimeType';
    if coalesce(requested_form_data->>'guestGroupId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Invalid guest submission' using errcode = '22023';
    end if;
    if matched_guest_group_id is not null and (requested_form_data->>'guestGroupId')::uuid <> matched_guest_group_id then
      raise exception 'Invalid guest submission' using errcode = '22023';
    end if;
    inserted_guest_group_id := coalesce(matched_guest_group_id, (requested_form_data->>'guestGroupId')::uuid);
    if identification_path is null or identification_path not like matched_workspace_id::text || '/' || inserted_guest_group_id::text || '/%'
       or length(trim(coalesce(identification_name, ''))) not between 1 and 255
       or identification_mime not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif')
       or coalesce(identification_document->>'sizeBytes', '') !~ '^\d+$' then
      raise exception 'Invalid identification document' using errcode = '22023';
    end if;
    identification_size := (identification_document->>'sizeBytes')::bigint;
    if identification_size not between 1 and 20971520 then
      raise exception 'The identification document must be 20 MB or smaller' using errcode = '22023';
    end if;
  elsif submitted_rsvp = 'declined' and identification_document is not null then
    raise exception 'An identification document is not expected for this response' using errcode = '22023';
  end if;

  submitted_custom_answers := coalesce(requested_form_data->'customAnswers', '{}'::jsonb);
  if jsonb_typeof(submitted_custom_answers) is distinct from 'object' then
    raise exception 'Custom answers must be an object' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_object_keys(submitted_custom_answers)) > 10 then
    raise exception 'Too many custom answers were submitted' using errcode = '22023';
  end if;
  for answer_key in select jsonb_object_keys(submitted_custom_answers) loop
    if not exists (select 1 from jsonb_array_elements(form_settings->'customQuestions') q where q->>'id' = answer_key) then
      raise exception 'An answer does not match a question on this form' using errcode = '22023';
    end if;
  end loop;
  for question in select value from jsonb_array_elements(form_settings->'customQuestions') loop
    question_id := question->>'id';
    question_label := question->>'label';
    question_type := question->>'type';
    if submitted_custom_answers ? question_id
       and jsonb_typeof(submitted_custom_answers->question_id) is distinct from 'string' then
      raise exception 'Custom question answers must be text values' using errcode = '22023';
    end if;
    question_answer := trim(coalesce(submitted_custom_answers->>question_id, ''));
    if question->>'required' = 'true' and question_answer = '' then
      raise exception 'Answer the required question: %', question_label using errcode = '22023';
    end if;
    if question_answer <> '' then
      if question_type = 'text' and length(question_answer) > 500 then
        raise exception 'Custom text answers must be 500 characters or fewer' using errcode = '22023';
      elsif question_type = 'yes_no' and question_answer not in ('yes', 'no') then
        raise exception 'Choose yes or no for: %', question_label using errcode = '22023';
      elsif question_type = 'select' and not exists (
        select 1 from jsonb_array_elements_text(question->'options') as choices(choice) where choices.choice = question_answer
      ) then
        raise exception 'Choose one of the available answers for: %', question_label using errcode = '22023';
      end if;
      clean_custom_answers := clean_custom_answers || jsonb_build_object(
        question_id, jsonb_build_object('label', question_label, 'value', question_answer)
      );
    end if;
  end loop;

  if matched_guest_group_id is not null then
    inserted_guest_group_id := matched_guest_group_id;
    clean_custom_answers := clean_custom_answers || jsonb_build_object(
      'guest_entered_name', jsonb_build_object('label', 'Name entered by guest', 'value', clean_name)
    );
    update public.guest_groups as target_guest
    set guest_count = submitted_count,
        invitation_sent = true,
        invitation_sent_at = coalesce(invitation_sent_at, now()),
        rsvp_status = submitted_rsvp,
        public_rsvp_checkin_date = case when submitted_rsvp = 'confirmed' then submitted_checkin else null end,
        public_rsvp_checkout_date = case when submitted_rsvp = 'confirmed' then submitted_checkout else null end,
        public_rsvp_custom_answers = coalesce(public_rsvp_custom_answers, '{}'::jsonb) || clean_custom_answers
    where target_guest.id = matched_guest_group_id and target_guest.workspace_id = matched_workspace_id
    returning id into inserted_guest_group_id;
    if inserted_guest_group_id is null then
      raise exception 'This guest entry is no longer available' using errcode = '22023';
    end if;
  else
    if inserted_guest_group_id is null then
      if coalesce(requested_form_data->>'guestGroupId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        inserted_guest_group_id := (requested_form_data->>'guestGroupId')::uuid;
      else
        inserted_guest_group_id := gen_random_uuid();
      end if;
    end if;
    insert into public.guest_groups (
      id, workspace_id, family_name, contact_name, guest_count, invitation_sent,
      invitation_sent_at, rsvp_status, public_rsvp_checkin_date,
      public_rsvp_checkout_date, public_rsvp_custom_answers, self_rsvp
    ) values (
      inserted_guest_group_id, matched_workspace_id, clean_name, '', submitted_count, true, now(), submitted_rsvp,
      case when submitted_rsvp = 'confirmed' then submitted_checkin else null end,
      case when submitted_rsvp = 'confirmed' then submitted_checkout else null end,
      clean_custom_answers, true
    ) returning id into inserted_guest_group_id;
  end if;

  if identification_document is not null then
    insert into public.guest_documents (
      workspace_id, guest_group_id, storage_path, file_name, mime_type, size_bytes, document_type
    ) values (
      matched_workspace_id, inserted_guest_group_id, identification_path, identification_name,
      identification_mime, identification_size, 'identification'
    );
  end if;

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
