-- Keep the form's Required label for planners, but do not block an RSVP when
-- the guest omits identification documents.
do $migration$
declare
  function_definition text;
  required_document_check constant text := $check$
  if submitted_rsvp = 'confirmed' and coalesce((form_settings->>'requireIdentificationDocument')::boolean, false)
     and coalesce(jsonb_array_length(identification_documents), 0) = 0 then
    raise exception 'Upload an identification document to submit this RSVP' using errcode = '22023';
  end if;
$check$;
begin
  function_definition := pg_get_functiondef('public.submit_public_workspace_rsvp(text,jsonb)'::regprocedure);
  if position(required_document_check in function_definition) > 0 then
    function_definition := replace(function_definition, required_document_check, '');
    execute function_definition;
  end if;
end;
$migration$;
