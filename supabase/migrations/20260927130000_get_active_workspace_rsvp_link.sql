create or replace function public.get_active_workspace_rsvp_link(requested_workspace_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_token text;
begin
  if auth.uid() is null or not public.has_permission('app_data.manage', requested_workspace_id) then
    raise exception 'You cannot view the RSVP link for this planning space' using errcode = '42501';
  end if;

  select link.token into result_token
  from public.workspace_public_rsvp_links link
  where link.workspace_id = requested_workspace_id
    and link.active;

  return result_token;
end;
$$;

revoke all on function public.get_active_workspace_rsvp_link(uuid) from public, anon;
grant execute on function public.get_active_workspace_rsvp_link(uuid) to authenticated;
