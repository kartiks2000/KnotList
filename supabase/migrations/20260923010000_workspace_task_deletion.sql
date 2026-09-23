-- Allow planning-space Admins to delete tasks. The task comments are removed
-- automatically by the workspace_task_comments_task_fk ON DELETE CASCADE.
drop policy if exists "Workspace task managers can delete tasks" on public.workspace_tasks;
create policy "Workspace task managers can delete tasks"
  on public.workspace_tasks for delete to authenticated
  using (public.has_permission('tasks.manage', workspace_id));

grant delete on public.workspace_tasks to authenticated;
