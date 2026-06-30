# Seed Data

`supabase/seed.sql` is intentionally empty for production.

Real restaurants should be created through the owner onboarding flow. Do not add
demo, test, sample, mock, or presentation restaurants to the production seed.

Use `supabase/production-demo-data-cleanup.sql` once to remove legacy demo and
presentation restaurants from an environment that was previously seeded.
