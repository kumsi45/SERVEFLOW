# Owner menu sales extension

Migration 267 is immutable. Migration 268 adds only `get_owner_menu_sales_report(uuid,text,date,date)`; the main report and its top-10 summary remain unchanged.

## Audited R3 semantics

- The population is paid or refunded invoices whose `paid_at` falls within the server-resolved half-open current period. Refunded invoices retain original item sales; this is not net collections.
- Item attribution uses tenant-scoped `order_items.invoice_id`, never the entire parent order. Appended invoice batches do not recount earlier items.
- Cancellation filtering is exactly `kitchen_status <> 'cancelled'`. It is not an order-status filter; NULL kitchen states follow SQL's existing exclusion behavior.
- Quantity is summed by `menu_item_id`. Value is the sum of quantity times each line's stored order-time price. Discounts, VAT, service charges, refunds and costs are not allocated.
- Ranking is quantity descending, value descending, menu UUID ascending. The original limit is ten; detail has no limit.
- Names/categories are current tenant-scoped catalog joins. Archived identities remain in sold history. Zero-sale items use `available AND archived_at IS NULL`, matching R3's current-menu eligibility.
- Invoice-less historical line counts are tenant-wide, not falsely assigned to the selected period. Unmatched catalog identities retain their amounts in the detail population and carry a separate count. The current NOT NULL/FK constraints normally prevent deleted/null menu identities; tests do not bypass these constraints to manufacture invalid production states.
- Authorization and local-day/week/month/custom boundaries reuse R3 helpers. No client UTC boundary input is introduced.

## Decisions

No single unit price is returned: one menu identity can have several stored transaction prices. Sales share uses the sum over exactly the complete ranked population, including safe unmatched identity groups; a zero denominator returns NULL.

The detail is fetched on demand, once per opening/period, independently of the main report. It returns aggregated identity rows and current zero-sale menu rows, not transaction lines. Hundreds of items are reasonable for this endpoint. Response size grows with distinct retained menu identities plus available menu items; exceptionally large catalogs may require future server pagination. No silent truncation or client reconstruction is used.

The menu component remounts when the accepted main response changes; pending detail responses cannot overwrite a newer component. A ref lock prevents duplicate detail requests. Its retained report scope stores the exact tenant and custom-date inputs associated with the displayed main response.

## Validation and release boundary

`node supabase/audits/owner-menu-sales-268-audit.cjs` creates candidate DDL and synthetic R3 fixtures in one transaction and always rolls back. It reuses the existing canonical cancellation fixture setup without editing the R3 audit. It never deploys or records a migration version.

Migration deployment is a separate release step. Until 268 is deployed, the new lazy detail displays an isolated retry state if the endpoint is absent; the existing main report remains available.
