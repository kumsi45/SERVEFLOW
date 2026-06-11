# Tenant Boundary

Tenant resolution contracts will live here after approval.

## Phase 1 Model

Every request resolves tenant context from the authenticated user's `restaurant_id`.

The database, not the frontend, enforces tenant isolation through RLS.

No tenant workflows are implemented in this phase.
