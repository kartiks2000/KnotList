grant delete on public.workspace_notifications to authenticated;

create policy "Users can delete their own workspace notifications"
  on public.workspace_notifications for delete to authenticated
  using (
    user_id = auth.uid()
    and (
      public.has_permission('lodging.read', workspace_id)
      or public.has_permission('app_data.read', workspace_id)
    )
  );
