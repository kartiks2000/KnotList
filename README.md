# Knotlist

A mobile-first React + TypeScript starter for a wedding planning app. The current foundation includes Supabase email/password authentication and database-enforced account, workspace, role, and permission foundations. Wedding planning data and workflows are intentionally not implemented yet.

## Run the app

1. Use Node.js `22.19.0` (`nvm use`).
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env.local` and set your Supabase project URL and anon/publishable key.
4. Run `npm run dev`.

The frontend only uses the Supabase publishable/anon key. Never put a service role key in a `VITE_*` variable or in browser code.

## Deploy the web app

Build the production site with `npm run build`; the static files are written to `dist/`. Configure your hosting provider to run `npm run build` and publish `dist/`. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the provider's production environment variables.

After your site has a public URL, set it as the Supabase Auth site URL and add it to the allowed redirect URLs. Set the `APP_URL` Supabase secret to the same public origin so workspace invitation links return to the deployed app:

```sh
supabase secrets set APP_URL="https://your-public-domain.example"
```

Use only the Supabase publishable/anon key in the web app. Keep service-role keys and other secrets in trusted server-side environments.

## Build the iOS and Android apps with Capacitor

Capacitor wraps the existing Vite app in native iOS and Android projects. The app uses the same Supabase backend and UI as the web app.

1. Use Node.js 22 or newer (`nvm use` uses the version in `.nvmrc`).
2. Install dependencies with `npm install`.
3. Make sure `.env.local` contains the Supabase URL and anon/publishable key before building.
4. Build and copy the web app into both native projects:

   ```sh
   npm run cap:sync
   ```

5. Open a native project in its IDE:

   ```sh
   npm run cap:open:ios
   npm run cap:open:android
   ```

The iOS build requires macOS and Xcode 26 or newer. Android builds require Android Studio 2025.2.1 or newer and an Android SDK. After changing web code, run `npm run cap:sync` again before testing the native app. The `com.knotlist.app` application identifier is configured in `capacitor.config.ts`; change it before publishing if you use a different permanent store identifier.

Email confirmation and invitation links currently use the web app URL. Add native deep-link/universal-link handling and configure the matching Supabase Auth redirect URLs before relying on those email flows in the installed app.

## Set up Supabase auth, roles, and guest list

1. Create a Supabase project and configure Auth email/password and email-confirmation settings to suit your launch.
2. For a new project, apply the migrations in order: [`20260922000000_auth_rbac_foundation.sql`](supabase/migrations/20260922000000_auth_rbac_foundation.sql), [`20260922010000_guest_groups.sql`](supabase/migrations/20260922010000_guest_groups.sql), [`20260922020000_single_guest_count.sql`](supabase/migrations/20260922020000_single_guest_count.sql), [`20260922030000_room_assignments.sql`](supabase/migrations/20260922030000_room_assignments.sql), [`20260922040000_workspace_admin_invites.sql`](supabase/migrations/20260922040000_workspace_admin_invites.sql), [`20260922050000_lodging_access_role.sql`](supabase/migrations/20260922050000_lodging_access_role.sql), [`20260922060000_guest_gift_tracking.sql`](supabase/migrations/20260922060000_guest_gift_tracking.sql), [`20260923000000_workspace_tasks.sql`](supabase/migrations/20260923000000_workspace_tasks.sql), [`20260923010000_workspace_task_deletion.sql`](supabase/migrations/20260923010000_workspace_task_deletion.sql), [`20260923020000_workspace_task_descriptions.sql`](supabase/migrations/20260923020000_workspace_task_descriptions.sql), and [`20260923030000_guest_documents.sql`](supabase/migrations/20260923030000_guest_documents.sql). If you already applied earlier migrations, run only the migrations you have not applied, in order. Run each migration once.
3. Create your first account from the app and confirm its email if confirmation is enabled.
4. In the Supabase SQL Editor, edit and run [`supabase/bootstrap/first_super_admin.sql`](supabase/bootstrap/first_super_admin.sql) with that account's email. Keep super-admin bootstrap restricted to trusted project operators.
5. Sign in as the super admin and create a planning space in the app. The guest list is scoped to that workspace.
6. Restart the Vite server after editing `.env.local`.

## Invite people to a planning space

Workspace admins can invite Lodging users to the currently selected planning space; only super admins can invite Admin users. Lodging users can see and update guest counts and room assignments through restricted database functions. They cannot access guest contacts, invitation or RSVP details, or notes. New accounts receive a Supabase Auth invitation email; existing accounts are added directly. A user can belong to multiple planning spaces by being invited to each one separately. Memberships use `role_id`, so additional workspace roles can be introduced later without changing membership records.

Deploy the trusted Edge Function after linking the Supabase CLI to your project:

```sh
supabase functions deploy invite-workspace-admin
supabase secrets set APP_URL="http://localhost:5174"
```

Set `APP_URL` to the app's public origin in production. Add that origin to Supabase Auth's allowed redirect URLs. The function uses Supabase's server-side Auth admin API; never add a service-role or secret key to `.env.local` or browser code.

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

1. Add password reset, account settings, and session recovery UX.
2. Add role-aware membership changes and removal through the trusted backend.
3. Add generated Supabase database types and use them in the browser client.
4. Add future product tables with workspace foreign keys, indexes, RLS read/write policies, and permission checks from day one.

The app includes sign-in, sign-up, session display, sign-out, workspace creation for super admins, admin invitations, workspace people listing, and guest-family list and edit flows. Workspace role changes and member removal are not yet available.
