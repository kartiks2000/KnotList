-- The RSVP function returns a workspace_id output column, which conflicts
-- with the unqualified guest_groups.workspace_id in its UPDATE predicate.
do $migration$
declare
  function_definition text;
  original_update text := E'update public.guest_groups\n    set guest_count';
  qualified_update text := E'update public.guest_groups as target_guest\n    set guest_count';
  original_predicate text := 'where id = matched_guest_group_id and workspace_id = matched_workspace_id';
  qualified_predicate text := 'where target_guest.id = matched_guest_group_id and target_guest.workspace_id = matched_workspace_id';
begin
  function_definition := pg_get_functiondef('public.submit_public_workspace_rsvp(text,jsonb)'::regprocedure);
  if position(original_update in function_definition) > 0
     and position(original_predicate in function_definition) > 0 then
    function_definition := replace(function_definition, original_update, qualified_update);
    function_definition := replace(function_definition, original_predicate, qualified_predicate);
    execute function_definition;
  elsif position(qualified_update in function_definition) = 0
     or position(qualified_predicate in function_definition) = 0 then
    raise exception 'Could not find the expected personal RSVP update in submit_public_workspace_rsvp';
  end if;
end;
$migration$;
