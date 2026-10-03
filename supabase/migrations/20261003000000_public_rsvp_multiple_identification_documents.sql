-- Accept and store up to eight identification files for one RSVP, capped at
-- 2 MiB per file. Patch the latest shared/personal RSVP submit function so
-- guest-specific updates and shared-link inserts keep the same transaction.
do $migration$
declare
  function_definition text;
  old_declaration constant text := '  identification_document jsonb;';
  new_declaration constant text := E'  identification_documents jsonb;\n  identification_document jsonb;';
  start_position integer;
  end_position integer;
  insert_start integer;
  insert_end integer;
begin
  function_definition := pg_get_functiondef('public.submit_public_workspace_rsvp(text,jsonb)'::regprocedure);

  if position('identification_documents := requested_form_data' in function_definition) = 0 then
  if position('identification_documents jsonb;' in function_definition) = 0 then
    if position(old_declaration in function_definition) = 0 then
      raise exception 'Could not find identification document variables in submit_public_workspace_rsvp';
    end if;
    function_definition := replace(function_definition, old_declaration, new_declaration);
  end if;

  start_position := position('identification_document :=' in function_definition);
  end_position := position('submitted_custom_answers :=' in function_definition);
  if start_position = 0 or end_position <= start_position then
    raise exception 'Could not find identification document validation in submit_public_workspace_rsvp';
  end if;

  function_definition := substring(function_definition from 1 for start_position - 1)
    || $validation$
  identification_documents := requested_form_data->'identificationDocuments';
  -- Continue accepting the previous single-file property for existing clients.
  if identification_documents is null and requested_form_data ? 'identificationDocument' then
    identification_documents := jsonb_build_array(requested_form_data->'identificationDocument');
  end if;
  if identification_documents is not null and jsonb_typeof(identification_documents) <> 'array' then
    raise exception 'Identification documents must be an array' using errcode = '22023';
  end if;
  if coalesce(jsonb_array_length(identification_documents), 0) > 8 then
    raise exception 'Upload no more than 8 identification documents' using errcode = '22023';
  end if;
  if submitted_rsvp = 'confirmed' and coalesce((form_settings->>'requireIdentificationDocument')::boolean, false)
     and coalesce(jsonb_array_length(identification_documents), 0) = 0 then
    raise exception 'Upload an identification document to submit this RSVP' using errcode = '22023';
  end if;
  if coalesce(jsonb_array_length(identification_documents), 0) > 0 then
    if submitted_rsvp <> 'confirmed' or not coalesce((form_settings->>'askIdentificationDocument')::boolean, false) then
      raise exception 'Identification documents are not expected for this response' using errcode = '22023';
    end if;
    if coalesce(requested_form_data->>'guestGroupId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Invalid guest submission' using errcode = '22023';
    end if;
    if matched_guest_group_id is not null and (requested_form_data->>'guestGroupId')::uuid <> matched_guest_group_id then
      raise exception 'Invalid guest submission' using errcode = '22023';
    end if;
    inserted_guest_group_id := coalesce(matched_guest_group_id, (requested_form_data->>'guestGroupId')::uuid);

    for identification_document in select value from jsonb_array_elements(identification_documents) loop
      identification_path := identification_document->>'storagePath';
      identification_name := identification_document->>'fileName';
      identification_mime := identification_document->>'mimeType';
      if jsonb_typeof(identification_document) <> 'object'
         or identification_path is null
         or identification_path not like matched_workspace_id::text || '/' || inserted_guest_group_id::text || '/%'
         or length(trim(coalesce(identification_name, ''))) not between 1 and 255
         or identification_mime not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif')
         or coalesce(identification_document->>'sizeBytes', '') !~ '^\d+$' then
        raise exception 'Invalid identification document' using errcode = '22023';
      end if;
      identification_size := (identification_document->>'sizeBytes')::bigint;
      if identification_size not between 1 and 2097152 then
        raise exception 'Each identification document must be 2 MB or smaller' using errcode = '22023';
      end if;
    end loop;
  end if;

$validation$
    || substring(function_definition from end_position);

  insert_start := position('  if identification_document is not null then' in function_definition);
  insert_end := position('  insert into public.lodging_notification_events' in function_definition);
  if insert_start = 0 or insert_end <= insert_start then
    raise exception 'Could not find identification document inserts in submit_public_workspace_rsvp';
  end if;

  function_definition := substring(function_definition from 1 for insert_start - 1)
    || $inserts$
  if jsonb_typeof(identification_documents) = 'array' then
    for identification_document in select value from jsonb_array_elements(identification_documents) loop
      insert into public.guest_documents (
        workspace_id, guest_group_id, storage_path, file_name, mime_type, size_bytes, document_type
      ) values (
        matched_workspace_id, inserted_guest_group_id,
        identification_document->>'storagePath', identification_document->>'fileName',
        identification_document->>'mimeType', (identification_document->>'sizeBytes')::bigint, 'identification'
      );
    end loop;
  end if;

$inserts$
    || substring(function_definition from insert_end);

  execute function_definition;
  end if;
end;
$migration$;
