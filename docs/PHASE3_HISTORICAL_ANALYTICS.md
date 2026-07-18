# Phase 3 Historical Analytics Contract

All historical consumers use half-open UTC windows `[range_start, range_end)`
derived from the restaurant's IANA timezone in `restaurants.profile.timezone`.
This prevents double counting at midnight and preserves 23/25-hour days across
daylight-saving transitions. Locale affects presentation only, never inclusion.

Canonical event timestamps:

| Metric | Timestamp |
| --- | --- |
| Revenue and collection hour | `order_invoices.paid_at` |
| Order volume and arrival hour | `orders.created_at` |
| Kitchen served/completed | `order_items.kitchen_completed_at` |
| Dining session closure/turnover | `orders.dining_session_closed_at` |

Consequences:

- An order created before midnight and paid after midnight contributes order
  volume to the first day and revenue to the second day.
- A shift crossing midnight is split by the actual event timestamps, not by its
  opening date.
- Custom end dates are inclusive in the UI and converted to an exclusive next
  local midnight internally.
- Owner, Manager, Restaurant Intelligence/AI, Reports, CSV, and Excel consume
  the same canonical windows and summaries.

Migration 139 provides `get_canonical_historical_analytics` and supporting
indexes. It also corrects owner Sales, Financial, Inventory-demand, and AI RPCs
to use `paid_at` instead of `verified_at`.

