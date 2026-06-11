# Seed Data

Apply `supabase/seed.sql` after the Phase 1 and Phase 2 migrations to create a
deterministic public demo menu at `/r/demo`.

The seed refreshes only the restaurant with slug `demo`, then inserts:

- 1 restaurant
- 4 categories
- 8 menu items

It is safe to run repeatedly when you want the demo QR menu reset to its known
state.
