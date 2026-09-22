-- Run once in the Supabase SQL Editor after creating the first user in Auth.
-- Replace the email below with the exact email address of that Auth user.
do $$
declare
  bootstrap_email text := lower('kartiksaxena2000@gmail.com');
  bootstrap_user_id uuid;
  super_admin_role_id uuid;
begin
  select u.id into bootstrap_user_id
  from auth.users u
  where lower(u.email) = bootstrap_email;

  if bootstrap_user_id is null then
    raise exception 'No Supabase Auth user found for %', bootstrap_email;
  end if;

  select r.id into super_admin_role_id
  from public.roles r
  where r.key = 'super_admin' and r.workspace_id is null;

  if super_admin_role_id is null then
    raise exception 'Apply the auth/RBAC migration before bootstrapping a super admin';
  end if;

  insert into public.platform_roles (user_id, role_id)
  values (bootstrap_user_id, super_admin_role_id)
  on conflict do nothing;
end;
$$;
