-- Add private identity-document uploads to public RSVPs and a Self RSVP list filter.
alter table public.guest_documents
  add column if not exists document_type text not null default 'general';
alter table public.guest_documents
  drop constraint if exists guest_documents_document_type_check;
alter table public.guest_documents
  add constraint guest_documents_document_type_check check (document_type in ('general', 'identification'));

-- Keep regular attachments visible to lodging roles, but restrict identity documents to admins.
drop policy if exists "Workspace users can read guest documents" on public.guest_documents;
create policy "Workspace users can read guest documents"
  on public.guest_documents for select to authenticated
  using (
    (document_type = 'identification' and public.has_permission('app_data.manage', workspace_id))
    or (document_type = 'general' and (
      public.has_permission('app_data.read', workspace_id)
      or public.has_permission('lodging.read', workspace_id)
    ))
  );

drop policy if exists "Workspace users can read guest document files" on storage.objects;
create policy "Workspace users can read guest document files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'guest-documents'
    and exists (
      select 1 from public.guest_documents d
      where d.storage_path = storage.objects.name
        and ((d.document_type = 'identification' and public.has_permission('app_data.manage', d.workspace_id))
          or (d.document_type = 'general' and (
            public.has_permission('app_data.read', d.workspace_id)
            or public.has_permission('lodging.read', d.workspace_id)
          )))
    )
  );

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
  questions jsonb;
  clean_questions jsonb := '[]'::jsonb;
  question jsonb;
  question_id text;
  question_label text;
  question_type text;
  question_required boolean;
  question_options jsonb;
  clean_options jsonb;
  option_json jsonb;
  option_text text;
  seen_question_ids text[] := array[]::text[];
  seen_options text[];
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

  questions := coalesce(requested_settings->'customQuestions', '[]'::jsonb);
  if jsonb_typeof(questions) <> 'array' or jsonb_array_length(questions) > 10 then
    raise exception 'Custom questions must be a list of at most 10 questions' using errcode = '22023';
  end if;
  for question in select value from jsonb_array_elements(questions) loop
    question_id := question->>'id';
    question_label := trim(coalesce(question->>'label', ''));
    question_type := question->>'type';
    if coalesce(question_id, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or question_id = any(seen_question_ids) then
      raise exception 'Each custom question needs a unique ID' using errcode = '22023';
    end if;
    seen_question_ids := array_append(seen_question_ids, question_id);
    if length(question_label) not between 1 and 80 then
      raise exception 'Custom question labels must be 1–80 characters' using errcode = '22023';
    end if;
    if coalesce(question_type, '') not in ('text', 'yes_no', 'select') then
      raise exception 'Choose a supported custom question type' using errcode = '22023';
    end if;
    if jsonb_typeof(question->'required') is distinct from 'boolean' then
      raise exception 'Choose whether each custom question is required' using errcode = '22023';
    end if;

    clean_options := '[]'::jsonb;
    question_options := coalesce(question->'options', '[]'::jsonb);
    if question_type = 'select' then
      if jsonb_typeof(question_options) <> 'array' or jsonb_array_length(question_options) not between 2 and 20 then
        raise exception 'Choice questions need between 2 and 20 choices' using errcode = '22023';
      end if;
      seen_options := array[]::text[];
      for option_json in select value from jsonb_array_elements(question_options) loop
        if jsonb_typeof(option_json) <> 'string' then
          raise exception 'Every choice must be text' using errcode = '22023';
        end if;
        option_text := trim(option_json #>> '{}');
        if length(option_text) not between 1 and 80 or lower(option_text) = any(seen_options) then
          raise exception 'Choices must be unique, non-empty, and at most 80 characters' using errcode = '22023';
        end if;
        seen_options := array_append(seen_options, lower(option_text));
        clean_options := clean_options || jsonb_build_array(option_text);
      end loop;
    end if;
    question_required := (question->>'required')::boolean;
    clean_questions := clean_questions || jsonb_build_array(jsonb_build_object(
      'id', question_id,
      'label', question_label,
      'type', question_type,
      'required', question_required,
      'options', clean_options
    ));
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
    'noLabel', trim(requested_settings->>'noLabel'),
    'askIdentificationDocument', coalesce((requested_settings->>'askIdentificationDocument')::boolean, false),
    'requireIdentificationDocument', coalesce((requested_settings->>'askIdentificationDocument')::boolean, false) and coalesce((requested_settings->>'requireIdentificationDocument')::boolean, false),
    'customQuestions', clean_questions
  );
  insert into public.workspace_public_rsvp_settings as current_settings (workspace_id, settings, updated_by, updated_at)
  values (requested_workspace_id, clean_settings, auth.uid(), now())
  on conflict (workspace_id) do update
  set settings = excluded.settings, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return clean_settings;
end;
$$;

create or replace function public.submit_public_workspace_rsvp(requested_token text, requested_form_data jsonb)
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
  select w.id, w.name into matched_workspace_id, matched_workspace_name
  from public.workspace_public_rsvp_links l
  join public.workspaces w on w.id = l.workspace_id
  where l.token = requested_token and l.active;
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
    inserted_guest_group_id := (requested_form_data->>'guestGroupId')::uuid;
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
