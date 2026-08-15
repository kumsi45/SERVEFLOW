# Manager Reports V1 Production Closeout

## Final architecture

Manager Reports V1 is a historical and operational reporting workspace with nine bounded sections: Overview, Menu Performance, Sales & Payments, Cashier & Shifts, Kitchen, Staff Operations, Inventory, Guests & Tables, and Exceptions & Incidents. Manager notes remain embedded in the report flow.

The page uses the R1 `reportingPeriodWindow` contract for Today, Week, Month, and inclusive Custom dates. Invalid custom periods stop before any report RPC is called. One coordinated loader fetches the verified R2 financial, R3 menu/cashier, and R4 operational read models in parallel per validated period. It does not calculate financial truth from large browser-side raw datasets.

## Financial integrity

- Sales and tax totals come from the R2 frozen-invoice report.
- Menu sales value comes from R3 frozen order-item line prices.
- Cash drawer, expenses, handover, and reconciliation come from the R3 cashier report.
- Inventory history comes only from the R4 immutable movement ledger.
- Orders Created and Average Paid Invoice remain separate concepts.
- Errors and authorization failures clear the report rather than rendering failed RPCs as zero.

## Operational truth

Kitchen uses strict preparation-start/completion milestones and the existing 25-minute delay threshold. Staff Operations shows attributed event counts without rankings or scores. Guests/Tables reports sessions and service events without claiming guest count. Attention Required contains only returned incidents, unresolved complaints, reconciliation state, recorded variance, kitchen delay, and recorded inventory loss.

## Manager actions

Managers can record explicit incidents, append incident decisions, resolve incidents with required resolution notes, and add a date/period-associated manager note through the R4 manager-authorized RPCs. The UI does not implement chat or fabricate normal events as incidents.

## Export boundary

PDF and UTF-8 BOM CSV are generated from the already authorized, tenant-scoped selected-period report bundle. PDF includes the business, manager, selected period, generated timestamp, and all available V1 sections. CSV is bounded to useful tabular facts. CSV cells beginning with spreadsheet formula characters are prefixed to prevent formula execution. Neither export calls Owner reporting contracts or independently queries raw cross-tenant datasets.

## Responsive behavior

The tab strip remains horizontally scrollable inside its own container. At tablet/mobile widths, wide tables become labelled record cards, metric grids collapse, custom dates remain usable, and incident details become a bottom sheet. No fixed report workspace covers content.

## Security and deployment

Migration 239 is deployed and frozen at `Local 239 | Remote 239`. Deployed rollback audits verify R2 financial, R3 menu/cashier, and R4 operational access with Manager-only tenant authority and denial for cross-tenant/non-manager actors. No R5 database migration was required.

## Known limitations

- Historical menu availability and party-size/guest count remain unavailable.
- Inventory history begins with the movement ledger and is `mixed_legacy` before complete ledger coverage.
- Legacy financial provenance remains visible through R2 quality flags.
- PDF uses a compact text-first layout rather than decorative charts.
- The responsive Playwright closeout is a production-tree fixture, not an authenticated browser session against a seeded restaurant.
