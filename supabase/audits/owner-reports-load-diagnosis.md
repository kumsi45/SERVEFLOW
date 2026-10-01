# Owner Reports load diagnosis

Verified against the configured hosted database and REST API on 2026-09-30. No deployment performed.

## Confirmed cause

Remote migration history ends at 268. Local migrations 269 and 270 are pending. The database has none of these functions:

- get_owner_report_inventory
- get_owner_report_cashier_shifts
- get_owner_report_inventory_v2
- get_owner_report_cashier_shifts_v2

The current frontend already uses the V2 functions defined by the existing Migration 270. Deploying 269 alone will not restore the current frontend. Preserve the prior performance implementation; review deployment of both pending migrations separately from this UI correction.

## Exact API errors

Both requests returned HTTP 404, code PGRST202:

`Could not find the function public.get_owner_report_inventory_v2(cursor_at, cursor_id, custom_end_date, custom_start_date, detail_section, page_size, requested_period, target_restaurant_id) in the schema cache`

`Could not find the function public.get_owner_report_cashier_shifts_v2(cursor_at, cursor_id, custom_end_date, custom_start_date, detail_section, page_size, requested_period, target_restaurant_id) in the schema cache`

Database probes independently returned SQLSTATE 42883 (function does not exist). REST probes used the configured public API key without a signed-in Owner session; they are missing-function evidence, not an authenticated browser replay.

## Frontend and candidate contract

The service passes restaurant UUID, requested period, optional custom start/end dates, detail section, optional timestamp/UUID cursor, and page_size 50. These match the existing V2 SQL signature `(uuid,text,date,date,text,timestamptz,uuid,integer)` and default initial section. V1 in 269 accepts only the first four arguments.

The V2 parser expects owner_inventory_report_v2 / owner_cashier_report_v2, a server-resolved period, full summary, quality, and page objects containing items and nextCursor. It maps those pages to arrays and independent next cursors for the UI. This agrees with 270. Missing RPCs fail before authorization, period resolution, SQL body execution, or parsing; there is no evidence those later stages caused the reported failures.

Existing candidate SQL requires active Owner access for the target restaurant, uses fixed search_path, grants authenticated execution, and denies anonymous execution. The existing rollback audit is used to validate these candidate paths without persisting DDL or fixtures.

Service errors retain the original Supabase error as cause. They reject rather than returning an empty report. UI failure cards remain visible, with short business wording. Valid empty results retain their separate empty states.

## Verification scope

The compact-layout browser probe uses representative markup and the real Owner styles at 1440, 430, 390, and 360px. It verifies type sizes, touch targets, and overflow; it does not certify the authenticated full application or live network interaction.

Migrations 267, 268, 269, and 270 were not edited in this correction. Deployment requires explicit approval. No fallback to an unbounded V1 response was introduced.
