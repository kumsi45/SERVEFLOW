# Phase 7A.2 — Runtime Realtime and RPC Stabilization

## Root causes

- Kitchen queue and action RPCs used different batch predicates. A visible station ticket could fail an exact timestamp-derived batch match.
- Migration 144 renamed the waiter base RPC while its PL/pgSQL body retained `submit_waiter_order_batch.<parameter>` qualifiers, which PostgreSQL then parsed as a missing table reference.
- Manager loaded through security-definer RPCs but lacked table SELECT policies required by Postgres Changes.
- Kitchen Realtime SELECT policy still depended on legacy paid order status instead of canonical operational status.
- Anonymous Customer QR sessions cannot safely SELECT order tables, so their connected Postgres Changes channel correctly delivered no rows.

## Fixes

- `transition_station_kitchen_items` is the single selector for Start, Ready and Served transitions. Exact batch is preferred; fallback stays inside the same tenant/order/station.
- Recompiled the renamed waiter base RPC with its correct function qualifier.
- Added tenant-scoped Manager and operational Kitchen Realtime SELECT policies.
- Published the Manager activity tables consumed by the shared event service.
- Added customer tracking Broadcast triggers addressed by the unguessable browser session token; `RestaurantEventService` owns the client channel and verifies `restaurant_id`.

## Migrations

- `147_phase7a2_kitchen_waiter_rpc_stabilization.sql`
- `148_phase7a2_role_realtime_visibility.sql`
- `149_phase7a2_customer_tracking_broadcast.sql`

## Manual acceptance status

The fixes are deployed, but Coffee -> Pizza -> Burger and authenticated Kitchen lifecycle clicks were not fabricated against occupied production tables. Manual results remain pending and must be recorded before production readiness is declared.
