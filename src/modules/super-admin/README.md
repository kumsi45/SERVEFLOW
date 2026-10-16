# Super Admin

SA2 local implementation: private `/platform-admin/...` routes, dedicated session namespace, TOTP flow, authorized control-plane views and reviewed mutations.

Requires unapplied migration candidates 276 and 277 and separately verified administrator provisioning. No live administrator was provisioned. Database behavior and hosted enforcement are unverified.

See `docs/SUPER_ADMIN_PROVISIONING_AND_RECOVERY.md` and `docs/SUPER_ADMIN_SA2_REPORT.md`. Unresolved lifecycle, delivery, entitlement cutover and recovery actions remain unavailable. Do not use the persistent printer/workspace stack for fixtures.
