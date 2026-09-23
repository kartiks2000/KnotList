-- Lodging users may view and download the documents attached to guests in
-- workspaces where they have lodging access. Upload and delete stay admin-only.
drop policy if exists "Workspace users can read guest documents" on public.guest_documents;
create policy "Workspace users can read guest documents"
  on public.guest_documents for select to authenticated
  using (
    public.has_permission('app_data.read', workspace_id)
    or public.has_permission('lodging.read', workspace_id)
  );

drop policy if exists "Workspace users can read guest document files" on storage.objects;
create policy "Workspace users can read guest document files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'guest-documents'
    and exists (
      select 1 from public.guest_documents d
      where d.storage_path = storage.objects.name
        and (
          public.has_permission('app_data.read', d.workspace_id)
          or public.has_permission('lodging.read', d.workspace_id)
        )
    )
  );
