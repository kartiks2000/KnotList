-- Ask only Yes/No first. A declined RSVP skips the attendee count and required
-- follow-up questions; confirmed RSVPs continue to use the configured checks.
do $migration$
declare
  function_definition text;
  old_guest_count_check constant text := $old$if (form_settings->>'askGuestCount')::boolean then$old$;
  new_guest_count_check constant text := $new$if submitted_rsvp = 'confirmed' and (form_settings->>'askGuestCount')::boolean then$new$;
  old_required_question_check constant text := $old$if question->>'required' = 'true' and question_answer = '' then$old$;
  new_required_question_check constant text := $new$if submitted_rsvp = 'confirmed' and question->>'required' = 'true' and question_answer = '' then$new$;
begin
  function_definition := pg_get_functiondef('public.submit_public_workspace_rsvp(text,jsonb)'::regprocedure);

  if position(new_guest_count_check in function_definition) = 0 then
    if position(old_guest_count_check in function_definition) = 0 then
      raise exception 'Could not find the guest-count validation in submit_public_workspace_rsvp';
    end if;
    function_definition := replace(function_definition, old_guest_count_check, new_guest_count_check);
  end if;

  if position(new_required_question_check in function_definition) = 0 then
    if position(old_required_question_check in function_definition) = 0 then
      raise exception 'Could not find the required-question validation in submit_public_workspace_rsvp';
    end if;
    function_definition := replace(function_definition, old_required_question_check, new_required_question_check);
  end if;

  execute function_definition;
end;
$migration$;
