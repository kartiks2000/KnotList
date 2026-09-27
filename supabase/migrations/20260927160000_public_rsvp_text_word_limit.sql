-- Keep public text answers concise while retaining room for a longer wish.
do $$
declare
  function_definition text;
begin
  function_definition := pg_get_functiondef('public.submit_public_workspace_rsvp(text,jsonb)'::regprocedure);
  if position('length(question_answer) > 2000' in function_definition) = 0 then
    raise exception 'Could not find the expected custom text length validation in submit_public_workspace_rsvp';
  end if;
  function_definition := replace(
    function_definition,
    'if question_type = ''text'' and length(question_answer) > 2000 then',
    'if question_type = ''text'' and (length(question_answer) > 2000 or cardinality(regexp_split_to_array(trim(question_answer), ''\s+'')) > 100) then'
  );
  function_definition := replace(
    function_definition,
    'Custom text answers must be 2,000 characters or fewer',
    'Text answers must be 100 words or fewer (and 2,000 characters or fewer)'
  );
  execute function_definition;
end;
$$;
