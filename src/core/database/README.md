# Database Boundary

Database access rules and adapters live here.

## Phase 1 Backbone

The Supabase schema and RLS foundation are defined in:

- `supabase/migrations/001_phase1_saas_backbone.sql`
- `supabase/policies/PHASE1_RLS.md`

## Supabase Client

The singleton Supabase client is defined in `src/core/database/supabaseClient.ts`.

It reads:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Do not commit real environment values.
