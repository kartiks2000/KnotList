-- Super admins invite users to one workspace at a time. Memberships remain
-- role_id based so future workspace roles can be added without changing them.
alter table public.profiles
  add column email text,
  add column email_confirmed_at timestamptz;

update public.profiles p
set email = lower(u.email),
    email_confirmed_at = u.email_confirmed_at
from auth.users u
where u.id = p.id;

create unique index profiles_email_lower_unique
  on public.profiles (lower(email))
  where email is not null;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, email, email_confirmed_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', ''),
    lower(new.email),
    new.email_confirmed_at
  )
  on conflict (id) do update
    set email = excluded.email,
        email_confirmed_at = excluded.email_confirmed_at;
  return new;
end;
$$;

create or replace function public.sync_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set email = lower(new.email),
      email_confirmed_at = new.email_confirmed_at
  where id = new.id;
  return new;
end;
$$;

create trigger auth_user_profile_sync
  after update of email, email_confirmed_at on auth.users
  for each row execute procedure public.sync_auth_user_profile();

create policy "Super admins can read profiles of workspace members"
  on public.profiles for select to authenticated
  using (
    exists (
      select 1
      from public.workspace_memberships wm
      where wm.user_id = profiles.id
        and public.has_permission('users.manage', wm.workspace_id)
    )
  );
