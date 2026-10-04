-- A declined RSVP always contributes zero people to the planning headcount.
-- Enforce this for admin edits and all other writes, not only this UI.
create or replace function public.zero_declined_guest_headcount()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.rsvp_status = 'declined' then
    new.guest_count := 0;
  end if;
  return new;
end;
$$;

drop trigger if exists guest_groups_zero_declined_headcount on public.guest_groups;
create trigger guest_groups_zero_declined_headcount
before insert or update of rsvp_status, guest_count on public.guest_groups
for each row execute function public.zero_declined_guest_headcount();

update public.guest_groups
set guest_count = 0
where rsvp_status = 'declined' and guest_count <> 0;

-- Keep the RPC result aligned with the stored count so follow-up notification
-- messages report zero as well. This RPC serves both shared and guest-specific
-- RSVP form submissions.
do $migration$
declare
  function_definition text;
  old_return constant text := $old$return query select matched_workspace_name, matched_workspace_id, inserted_guest_group_id,
    inserted_notification_event_id, submitted_count, submitted_rsvp;$old$;
  new_return constant text := $new$return query select matched_workspace_name, matched_workspace_id, inserted_guest_group_id,
    inserted_notification_event_id, case when submitted_rsvp = 'declined' then 0 else submitted_count end, submitted_rsvp;$new$;
begin
  function_definition := pg_get_functiondef('public.submit_public_workspace_rsvp(text,jsonb)'::regprocedure);
  if position(new_return in function_definition) = 0 then
    if position(old_return in function_definition) = 0 then
      raise exception 'Could not find the RSVP result in submit_public_workspace_rsvp';
    end if;
    function_definition := replace(function_definition, old_return, new_return);
    execute function_definition;
  end if;
end;
$migration$;
