# Phase 7A — Complete Realtime Migration

## Architecture

```text
Supabase Realtime
        |
        v
RestaurantEventService (one channel per authenticated client + restaurant)
        |-- server filter: restaurant_id = active tenant
        |-- payload tenant verification
        |-- reconnect / wake recovery
        |-- canonical event mapping and shared deduplication boundary
        |
        +--> useRestaurantEvents
        +--> useTenantRealtime
        +--> createRestaurantEventConsumer (incremental Owner compatibility)
                  |
                  v
Cashier / Kitchen / Owner / Manager / Waiter / Customer QR / Inventory
```

## Consumers

| Consumer | Shared API | Data reaction |
| --- | --- | --- |
| Cashier | `getRestaurantEventStream` | Debounced queue, invoice, shift and table refresh |
| Kitchen | `getRestaurantEventStream` | Station-aware order refresh; payment remains ignored |
| Owner | `createRestaurantEventConsumer` | Preserved incremental order/item mutation and targeted payment, shift, table, menu, station, staff and configuration refresh |
| Manager pages | `useTenantRealtime` | Debounced dashboard/report/AI snapshot refresh |
| Manager chrome | `useRestaurantEvents` | Shared live alert counter |
| Waiter | `useTenantRealtime` with waiter auth client | Table, assignment, order, item and invoice refresh |
| Customer QR | `getRestaurantEventStream` | Tracking, invoice, items and served-feedback refresh |
| Inventory | `useTenantRealtime` | Request and stock intelligence refresh |

## Isolation and channel ownership

All runtime `postgres_changes` bindings are owned by `src/core/realtime/restaurantEventService.ts`. Ordinary tenant tables use `restaurant_id=eq.<restaurantId>`. The `restaurants` relation uses the equivalent primary-key filter `id=eq.<restaurantId>`. Every received row is checked again against the stream tenant before dispatch.

The stream registry is keyed by Supabase client and restaurant ID. This preserves isolated staff/waiter authentication clients while preventing duplicate channels within one role/tenant runtime.

## Validation

- Application source scan: only `RestaurantEventService` contains `.channel(` or `postgres_changes`.
- TypeScript and production Vite build pass.
- Source-contract tests enforce centralized channel ownership and tenant filtering.
- `git diff --check` passes.

Live multi-browser delivery timing and four-restaurant database mutation tests require authenticated fixtures and are not represented as automatically verified by the static source contract.
