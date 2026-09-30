-- Lower the guest document and RSVP identification upload cap to 2 MiB.
-- Preserve existing larger-file metadata while enforcing the new cap on inserts.
alter table public.guest_documents
  drop constraint if exists guest_documents_size_bytes_check;

alter table public.guest_documents
  add constraint guest_documents_size_bytes_check
  check (size_bytes between 1 and 2097152) not valid;

update storage.buckets
set file_size_limit = 2097152
where id = 'guest-documents';
