# Knotlist

A mobile-first React + TypeScript starter for a wedding planning app. The current foundation includes Supabase email/password authentication and database-enforced account, workspace, role, and permission foundations. Wedding planning data and workflows are intentionally not implemented yet.

## Run the app

1. Use Node.js `22.19.0` (`nvm use`).
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env.local` and set your Supabase project URL and anon/publishable key.
4. Run `npm run dev`.

The frontend only uses the Supabase publishable/anon key. Never put a service role key in a `VITE_*` variable or in browser code.

## Set up Supabase auth and roles

1. Create a Supabase project and configure Auth email/password and email-confirmation settings to suit your launch.
2. Apply [`supabase/migrations/20260922000000_auth_rbac_foundation.sql`](supabase/migrations/20260922000000_auth_rbac_foundation.sql) using the Supabase SQL Editor, or add it to a Supabase CLI migration history and deploy it with the CLI.
3. Create your first account from the app and confirm its email if confirmation is enabled.
4. In the Supabase SQL Editor, edit and run [`supabase/bootstrap/first_super_admin.sql`](supabase/bootstrap/first_super_admin.sql) with that account's email. Keep super-admin bootstrap restricted to trusted project operators.
5. Restart the Vite server after editing `.env.local`.

Public signup only creates an authenticated user and profile. It does not create a workspace, assign roles, or grant access to wedding data. The initial super admin is deliberately assigned through a trusted SQL operation rather than a browser flow.

## Authorization model

- `profiles` stores user-facing profile fields linked one-to-one to `auth.users`.
- `workspaces` is the ownership boundary for future wedding data. Future tables should include `workspace_id` and enable RLS.
- `roles` holds built-in global roles and workspace-scoped role definitions; `permissions` is the extensible permission catalog; `role_permissions` maps permissions to roles.
- `workspace_memberships` assigns a user a role in one workspace. The built-in `admin` role can read and manage app data in its assigned workspace.
- `platform_roles` holds platform-wide assignments. `super_admin` receives platform-wide authorization and can manage role definitions and memberships.
- `public.has_permission(permission, workspace_id)` is the database helper for future RLS policies. The frontend is not an authorization boundary.

Only the super admin can currently create role definitions, grant platform roles, or add and change workspace memberships. Admins manage app data through the permission model but cannot grant themselves more access. New permission keys should be added in migrations, paired with policies on each data table. New roles receive only explicitly assigned permissions.

## Planned follow-on auth work

1. Add secure invitations and membership management using a Supabase Edge Function or trusted backend; never expose the service role key in the client.
2. Add password reset, account settings, and session recovery UX.
3. Add generated Supabase database types and use them in the browser client.
4. Add workspace creation and switching once the onboarding flow and tenancy rules are defined.
5. Add future product tables with workspace foreign keys, indexes, RLS read/write policies, and permission checks from day one.

The app currently includes sign-in, sign-up, session display, and sign-out only. It does not yet invite users, display role assignments, or implement role administration screens.
