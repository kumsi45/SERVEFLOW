# Supabase

Database migrations, policies, and seed placeholders live here.

## Phase 1 Migration

The backend SaaS foundation is defined in:

- `supabase/migrations/001_phase1_saas_backbone.sql`

## Environment

Use Vite environment variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

For `@supabase/supabase-js`, `VITE_SUPABASE_URL` should be the project base URL:

```txt
https://your-project-ref.supabase.co
```

Do not use the REST endpoint suffix `/rest/v1/` as the client URL.

## Production Seed

`supabase/seed.sql` is intentionally empty. Production restaurant data should be
created through onboarding, not seeded demo fixtures.

To remove legacy presentation data from an environment, run:

- `supabase/production-demo-data-cleanup.sql`

## Phase 3 Migration

Customer order creation is defined in:

- `supabase/migrations/004_phase3_customer_ordering_rpc.sql`
