# Parked migrations

This directory is intentionally outside `supabase/migrations/` and is not part
of Supabase CLI migration discovery.

## Owner Menu atomic/idempotent creation candidate

`owner_menu_item_creation_atomic_idempotent.PARKED.sql` was originally prepared
as local candidate migration 264. It was never deployed; production was at
migration 263 when it was parked.

Preserved SHA-256:

`06E8234B4E3ACCE277FF81ED14CCDE59704318B365DC995387653A3E05719537`

The SQL body is preserved byte-for-byte. Before any future revival it must be
re-audited against the then-current schema, revalidated for concurrency and
HTTP behavior, assigned the next production migration number, and separately
approved. It must not simply return as migration 264.
