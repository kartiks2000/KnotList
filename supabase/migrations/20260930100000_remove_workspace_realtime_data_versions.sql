-- Disable cross-client auto-refresh for guest, lodging, gifts, and task data.
-- Keep notification Realtime subscriptions, which use workspace_notifications.

do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'workspace_data_versions'
  ) then
    alter publication supabase_realtime drop table public.workspace_data_versions;
  end if;
end;
$$;

drop trigger if exists workspaces_create_data_version on public.workspaces;
drop trigger if exists guest_groups_bump_data_version on public.guest_groups;
drop trigger if exists workspace_tasks_bump_data_version on public.workspace_tasks;
drop trigger if exists workspace_task_comments_bump_data_version on public.workspace_task_comments;

drop function if exists public.create_workspace_data_version();
drop function if exists public.bump_workspace_data_version();
drop table if exists public.workspace_data_versions;
