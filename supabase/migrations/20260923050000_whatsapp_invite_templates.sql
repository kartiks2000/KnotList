-- A reusable WhatsApp invitation template and optional image/video per planning space.
create table public.whatsapp_invite_templates (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  message text not null default '',
  media_path text,
  media_file_name text,
  media_mime_type text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  constraint whatsapp_invite_media_metadata_complete check (
    (media_path is null and media_file_name is null and media_mime_type is null)
    or (media_path is not null and media_file_name is not null and media_mime_type is not null)
  ),
  constraint whatsapp_invite_media_path_matches_workspace check (
    media_path is null or media_path like workspace_id::text || '/%'
  )
);

create trigger whatsapp_invite_templates_set_updated_at
  before update on public.whatsapp_invite_templates
  for each row execute procedure public.set_updated_at();

alter table public.whatsapp_invite_templates enable row level security;

create policy "Workspace admins can read WhatsApp invite templates"
  on public.whatsapp_invite_templates for select to authenticated
  using (public.has_permission('app_data.manage', workspace_id));
create policy "Workspace admins can create WhatsApp invite templates"
  on public.whatsapp_invite_templates for insert to authenticated
  with check (public.has_permission('app_data.manage', workspace_id));
create policy "Workspace admins can update WhatsApp invite templates"
  on public.whatsapp_invite_templates for update to authenticated
  using (public.has_permission('app_data.manage', workspace_id))
  with check (public.has_permission('app_data.manage', workspace_id));
create policy "Workspace admins can delete WhatsApp invite templates"
  on public.whatsapp_invite_templates for delete to authenticated
  using (public.has_permission('app_data.manage', workspace_id));

grant select, insert, update, delete on public.whatsapp_invite_templates to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'whatsapp-invite-media',
  'whatsapp-invite-media',
  false,
  20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "Workspace admins can read WhatsApp invite media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'whatsapp-invite-media'
    and exists (
      select 1 from public.workspaces w
      where w.id::text = split_part(storage.objects.name, '/', 1)
        and public.has_permission('app_data.manage', w.id)
    )
  );
create policy "Workspace admins can upload WhatsApp invite media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'whatsapp-invite-media'
    and exists (
      select 1 from public.workspaces w
      where w.id::text = split_part(storage.objects.name, '/', 1)
        and public.has_permission('app_data.manage', w.id)
    )
  );
create policy "Workspace admins can update WhatsApp invite media"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'whatsapp-invite-media'
    and exists (
      select 1 from public.workspaces w
      where w.id::text = split_part(storage.objects.name, '/', 1)
        and public.has_permission('app_data.manage', w.id)
    )
  )
  with check (
    bucket_id = 'whatsapp-invite-media'
    and exists (
      select 1 from public.workspaces w
      where w.id::text = split_part(storage.objects.name, '/', 1)
        and public.has_permission('app_data.manage', w.id)
    )
  );
create policy "Workspace admins can delete WhatsApp invite media"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'whatsapp-invite-media'
    and exists (
      select 1 from public.workspaces w
      where w.id::text = split_part(storage.objects.name, '/', 1)
        and public.has_permission('app_data.manage', w.id)
    )
  );
