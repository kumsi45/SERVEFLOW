# SERVEFLOW Architecture

Phase 1 is backend SaaS foundation only.

No UI, feature routes, QR menu, ordering flow, kitchen dashboard, admin dashboard, or frontend components are implemented in this phase.

## Boundaries

- `src/app` will later own bootstrap, providers, and centralized routing.
- `src/core` will own business logic, tenant rules, permissions, database access, config, and guards.
- `src/modules` contains feature modules that remain locked until their approved phase.
- `src/shared` contains reusable non-business utilities, types, validation, and approved shared components.
- `supabase` contains schema, constraints, indexes, policies, and seed placeholders.

## Backend Backbone

The Phase 1 backend backbone is defined in:

- `supabase/migrations/001_phase1_saas_backbone.sql`
- `supabase/policies/PHASE1_RLS.md`
- `docs/SECURITY.md`
- `docs/PHASE1_SUPABASE_INTEGRATION_AUDIT.md`
- `docs/PHASE2_PUBLIC_QR_ACCESS.md`
- `docs/PHASE3_CUSTOMER_ORDERING.md`

## Routing

All routing will later be declared in `src/app/router`. Feature modules must not define top-level routing.
