-- Private PDF and image attachments for guest records.
create unique index if not exists guest_groups_id_workspace_id_unique
  on public.guest_groups (id, workspace_id);

create table public.guest_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  guest_group_id uuid not null,
  storage_path text not null unique,
  file_name text not null check (length(trim(file_name)) between 1 and 255),
  mime_type text not null check (mime_type in (
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
    'image/gif', 'image/heic', 'image/heif'
  )),
  size_bytes bigint not null check (size_bytes between 1 and 20971520),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint guest_documents_guest_workspace_fk
    foreign key (guest_group_id, workspace_id)
    references public.guest_groups (id, workspace_id) on delete cascade,
  constraint guest_documents_storage_path_matches_guest
    check (storage_path like workspace_id::text || '/' || guest_group_id::text || '/%')
);

create index guest_documents_guest_created_idx
  on public.guest_documents (workspace_id, guest_group_id, created_at desc);

alter table public.guest_documents enable row level security;

create policy "Workspace users can read guest documents"
  on public.guest_documents for select to authenticated
  using (public.has_permission('app_data.read', workspace_id));
create policy "Workspace admins can add guest documents"
  on public.guest_documents for insert to authenticated
  with check (public.has_permission('app_data.manage', workspace_id));
create policy "Workspace admins can delete guest documents"
  on public.guest_documents for delete to authenticated
  using (public.has_permission('app_data.manage', workspace_id));

grant select, insert, delete on public.guest_documents to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'guest-documents',
  'guest-documents',
  false,
  20971520,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "Workspace users can read guest document files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'guest-documents'
    and exists (
      select 1 from public.guest_documents d
      where d.storage_path = storage.objects.name
        and public.has_permission('app_data.read', d.workspace_id)
    )
  );

create policy "Workspace admins can upload guest document files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'guest-documents'
    and exists (
      select 1 from public.guest_groups g
      where g.id::text = split_part(storage.objects.name, '/', 2)
        and g.workspace_id::text = split_part(storage.objects.name, '/', 1)
        and public.has_permission('app_data.manage', g.workspace_id)
    )
  );

create policy "Workspace admins can delete guest document files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'guest-documents'
    and exists (
      select 1 from public.guest_groups g
      where g.id::text = split_part(storage.objects.name, '/', 2)
        and g.workspace_id::text = split_part(storage.objects.name, '/', 1)
        and public.has_permission('app_data.manage', g.workspace_id)
    )
  );
