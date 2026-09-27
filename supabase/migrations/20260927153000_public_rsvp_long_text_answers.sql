-- Allow a bounded longer text answer (for example, a guest's wish message).
do $$
declare
  function_definition text;
begin
  function_definition := pg_get_functiondef('public.submit_public_workspace_rsvp(text,jsonb)'::regprocedure);
  if position('length(question_answer) > 500' in function_definition) = 0 then
    raise exception 'Could not find the expected custom text length validation in submit_public_workspace_rsvp';
  end if;
  function_definition := replace(function_definition, 'length(question_answer) > 500', 'length(question_answer) > 2000');
  function_definition := replace(function_definition, 'Custom text answers must be 500 characters or fewer', 'Custom text answers must be 2,000 characters or fewer');
  execute function_definition;
end;
$$;
