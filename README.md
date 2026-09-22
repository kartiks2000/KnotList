# Knotlist

A mobile-first React + TypeScript starter for a wedding planning app. It contains a presentational app shell and a Supabase client configuration placeholder; no wedding data, authentication flows, or product actions are implemented.

## Get started

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and add your Supabase project URL and anon key.
3. Run `npm run dev`.

Supabase is initialized in `src/lib/supabase.ts` only when both environment variables are set. Keep service role keys out of the frontend.
