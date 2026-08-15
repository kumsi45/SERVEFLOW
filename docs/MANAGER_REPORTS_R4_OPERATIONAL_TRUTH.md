# Manager Reports R4 Operational Truth

## Scope

R4 adds backend reporting contracts for kitchen operations, attributed staff activity, immutable inventory movements, dining sessions and service requests, operational exceptions, and manager-authored incident decisions/notes. It does not add or redesign Reports UI, charts, PDF/export, Owner Reports, or AI interpretation.

Migration 238 was deployed and verified before R4 began. Migration 239 is the only R4 schema migration.

## Authority and tenant boundary

All R4 reads use `manager_can_report(restaurant_id)`. All writes additionally resolve an active `restaurant_staff` row whose role is exactly `manager`. Owner authority is intentionally not substituted. Direct table writes are revoked from authenticated clients; mutations are available only through manager-checked RPCs. Composite tenant foreign keys prevent incident assignment, creation, and decisions from referencing staff or incidents in another restaurant.

## Period rules

`get_manager_operational_report` accepts the R1 current and comparison UTC bounds. Both windows are half-open (`start <= event < end`), non-empty, and non-overlapping. The caller remains responsible for producing timezone-aware bounds through `ReportingPeriodWindow`.

Each metric uses the timestamp of the event it names:

- Kitchen received: `order_items.created_at`.
- Kitchen started: `kitchen_preparation_started_at`.
- Kitchen completed and duration grouping: `kitchen_completed_at`.
- Inventory: `inventory_movements.movement_date`; request creation uses `requested_at`.
- Dining session opened/closed: the corresponding session milestone.
- Assistance, complaint, feedback, cancellation, decision, and incident records: their own event timestamps.
- A manager note can be found by creation time, `note_date`, or explicit overlap with its associated reporting period.

## Kitchen truth

Preparation duration is calculated only when both canonical preparation-started and kitchen-completed milestones exist. Average, median, longest, and timed-row count are returned so incomplete legacy rows are visible rather than silently treated as zero-duration work.

The fixed 25-minute delayed-item definition is an operational threshold, not a staff score or performance grade. Results include raw station facts and comparison-period facts. The read model never synthesizes a start or completion timestamp.

## Staff truth

Staff reporting contains attributed event counts only: waiter-created orders, kitchen-completed items, inventory movements, and inventory request events. It includes the staff role and current active flag as context. It deliberately contains no score, rank, leaderboard, inferred efficiency, or judgment.

Cashier financial and shift facts remain in the R3 cashier report rather than being duplicated or reinterpreted in R4.

## Inventory truth

Historical inventory reporting is sourced only from the immutable `inventory_movements` ledger and the kitchen inventory request/event workflow. Movement quantities retain direction, movement type, unit, actor, source system, and `movement_date`.

Current item quantity is never used to reconstruct past stock. R4 therefore reports movement totals, labels history quality `mixed_legacy`, and sets scope to `movement_ledger_only`; it does not claim historical opening/closing balances when the ledger cannot prove them.

## Guests and tables truth

R4 reports dining sessions opened/closed, distinct tables with opened sessions, strict completed-session duration, assistance requests, complaints, and feedback. Orders and sessions are never converted into guest counts. Party size is not canonical in the current schema, so `guest_count_available` is always false.

Customer phone, session secrets, QR tokens, and feedback photo paths are not exposed by the R4 response.

## Exceptions and manager records

The report projects native complaint, cancellation-request, waste, and spoilage events with source provenance. It does not automatically persist ordinary operations as incidents.

Managers may explicitly create a V1 incident with type, source link, severity, title, summary, occurrence time, and optional assignee. Decisions are append-only audit rows. A decision can move an incident to reviewed, in progress, or resolved; resolution requires a note, and resolved incidents cannot be changed again through the RPC. Operational notes support a note date and optional explicit period association.

R4 begins complete incident/decision/note history only after migration 239. Older native sources are projected with their available history and quality is marked `legacy_unknown` where completeness cannot be guaranteed.

## Contracts

- `get_manager_operational_report(...)`
- `create_manager_report_incident(...)`
- `record_manager_incident_decision(...)`
- `create_manager_operational_note(...)`
- `managerR4ReportsService.ts` supplies parsing and typed callers for the four RPCs.

## Verification

The hosted rollback audit creates two isolated tenants and canonical kitchen, dining, assistance, complaint, feedback, incident, decision, and note fixtures. Checks A-W cover manager access, cross-tenant and non-manager denial, event-time facts, strict duration, no scores, ledger-only inventory, no inferred guest count, provenance, lifecycle resolution, and readback. Every fixture and migration application is rolled back.

Deployment of migration 239 is intentionally separate from validation. Until it is pushed, the current expected migration state is `Local 239 | Remote absent`; R4 is implemented and remotely rollback-validated, not deployed.
