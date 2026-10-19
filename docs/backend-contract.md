# Platform administration frontend contract

Status: frontend working contract, 2026-10-18. This document describes checked-in code and additional UI needs. It does not assert that migrations are deployed. The browser currently uses Supabase RPC, not a separate REST server.

## Existing data boundary

`AdminDataSource` in `src/modules/super-admin/platformAdminData.ts` provides `read(AdminQuery): Promise<AdminResult>` and `mutate(AdminMutationRequest): Promise<AdminMutationResult>`. The private implementation delegates to `platformAdminService.ts`; the development-only demo implements the same interface with an in-memory store. Components receive the data source and do not import fixtures. `AdminRow` is presently a generic record with `id` and `created_at`; resource-specific response typing is a future hardening need because the RPC returns JSON.

`AdminQuery` includes `resource`, `search`, `status`, cursor `{ at, id } | null`, and optional UTC date bounds (`from`, `through`). The private read calls `public.platform_admin_read` with `section`, `search_text`, `status_filter`, `cursor_at`, `cursor_id`, `since_at`, and exclusive `before_at`. Results include `asOf`, `source`, optional `items`, and `nextCursor`. A future API that supports offset/page-size sorting must specify stable order and total count; the current cursor RPC does not supply that contract.

| Resource | Current read and fields used by UI | Existing mutations or missing capability |
| --- | --- | --- |
| Overview | Nullable business, application, payment, contract, and trial counts | Read only; activity feed and health probes are unavailable privately. |
| Applications | `id`, business, type, contact, `status`, decision reason, created time; server also stores decision actor and time | `platform_admin_decide_application(application_id, decision, reason, request_id)`. Approval records delivery-disabled invitation intent; it does not send or provision. |
| Businesses | `id`, name, slug, owners, classification, version, created time | `platform_admin_classify(target_restaurant_id, classification, expected_version, reason, request_id)`. No suspend/restore operation. |
| Users and invitations | Member and invitation records | Read only. No role change, removal, send, acceptance, or provisioning operation in this UI contract. |
| Contracts | Term dates, kind, business | Read only. No activation, renewal, or expiry enforcement operation. |
| Payments | Business, amount, currency, channel, reference, paid time, status, reason | `platform_admin_record_payment(...)` records unverified evidence; `platform_admin_reject_payment(payment_id, reason, request_id)` rejects pending evidence. No confirm operation. |
| Notifications | Reminder identity, milestone, due time, delivery status | Read only; delivery disabled. |
| System health, integrations, backups, security | Limited static or unknown evidence | No active probe, restore, or recovery mutation. Unknown must stay unknown. |
| Diagnostics, audit logs, administrators | Redacted diagnostic and audit records; private administrator records | Diagnostic recording exists. No administrator creation, promotion, revocation, or recovery endpoint. |

## Target HTTP contract for a future backend

The existing browser implementation uses protected RPCs. The following versioned HTTP shape is the frontend contract for a future server; it is not an implemented endpoint set.

| Resource | Method and path | Query and response semantics |
| --- | --- | --- |
| Overview | `GET /v1/platform/overview` | Returns nullable queue and informational counts with an `asOf` timestamp. Absence is not zero. |
| Applications | `GET /v1/platform/applications` | `status`, `q`, `cursor`, `limit` (default/maximum 25), and `sort=submitted_at:desc`; response `{ items, nextCursor, total? }`. `GET /v1/platform/applications/:id` supports drawer deep links. |
| Application decision | `POST /v1/platform/applications/:id/decision` | Body `{ decision: "approved" | "rejected", reason, requestId }`; response includes `actor`, `decidedAt`, and the changed record. Reject reasons require 10 trimmed characters; approvals require a nonempty reviewed reason under the current private contract. |
| Businesses | `GET /v1/platform/businesses` and `GET /v1/platform/businesses/:id` | `classification`, `q`, `cursor`, `limit`, and stable newest-first sorting. Response carries lifecycle only when it is independently verified. |
| Classification | `POST /v1/platform/businesses/:id/classification` | Body `{ classification, expectedVersion, reason, requestId }`; stale versions return a conflict. Suspension and restoration need separate endpoints and enforcement. |
| Payments | `GET /v1/platform/payments` and `GET /v1/platform/payments/:id` | `status`, `q`, `cursor`, `limit`, and stable submitted-time sorting. Evidence is distinct from a confirmed payment. |
| Payment review | `POST /v1/platform/payments/:id/rejection` | Body `{ reason, requestId }`; rejects only pending evidence. Confirmation needs a separately authorized endpoint before the UI can offer it. |
| Read-only operations | `GET /v1/platform/{users,invitations,contracts,notifications,system-health,diagnostics,integrations,backups,audit-logs,administrators,security}` | Cursor reads return `{ items, nextCursor, asOf }`; health and backup values may be `unknown`. |

Every mutation response must include immutable audit fields: target ID, action, outcome, actor ID and display name where permitted, server timestamp, request ID, and record version where optimistic concurrency applies. Cursor order must be stable and opaque; an expired or malformed cursor returns a validation error rather than silently restarting a list.

## Error response shape

```json
{ "error": { "code": "CONFLICT", "message": "This record was already decided.", "requestId": "uuid" } }
```

`UNAUTHENTICATED` means no valid session; `FORBIDDEN` means a valid session without the capability; `VALIDATION` identifies a field-level reason problem; `NOT_FOUND` hides unavailable targets; `CONFLICT` covers stale versions, duplicate decisions, and idempotency disagreement; `RATE_LIMITED` carries retry information; `INTERNAL` exposes no private diagnostics. The server maps these shapes from its database errors without exposing SQLSTATE or raw exception text to the browser.

## Stage 6 business directory behavior

The business directory exposes the current name, owner, created time, and reviewed classification. It displays lifecycle as `Unknown` because the current read projection has no lifecycle field. Its detail drawer is addressable with `?business=<UUID>`. `Suspend` and `Restore` remain disabled, with a reason visible to keyboard and pointer users, until server-enforced mutations exist.

## Errors and permissions

The client maps SQLSTATE `42501` to denied authorization, `PT409`, `40001`, and `23505` to conflicts, `22023` and `23514` to validation errors, and `P0002` to missing records. Other failures remain unconfirmed service errors. Mutations carry a UUID `request_id` for retry handling. The private route requires a privately provisioned platform administrator with verified recovery and TOTP; management and sensitive operations have separate capability checks, and sensitive operations require recent MFA. UI disabling is only a convenience; server authorization remains authoritative.

## Business rules the backend must enforce

- Every decision must identify actor, timestamp, target, reason, and request ID. The checked-in migration currently requires 3-500 trimmed characters for application decisions, classification, payment evidence, and payment rejection. The redesigned rejection UI requests at least 10 characters; a matching server rule needs a future reviewed migration.
- Application decisions must be single-decision and conflict on a stale/repeated incompatible request. Classification uses expected version. Durable audit and idempotent replay remain server concerns.
- Classification is a reviewed label (`live`, `demo`, `unclassified`), not a paid entitlement or verified lifecycle status.
- Payment evidence is never auto-confirmed. Recording it does not activate a contract or subscription. Rejection is explicit; confirmation is unavailable.
- Suspension and restoration, invitation delivery, account provisioning, contract activation/renewal, reminder sending, and backup restoration remain unavailable until separate server enforcement and authorization exist.
- Nullable or absent counts, service status, and health timestamps cannot be inferred from a paged result or displayed as zero/healthy.
- Restaurant tenant membership never grants platform administrator rights.

## Stage 7 payment review behavior

`pending` payment evidence is labeled `Needs review`; a future confirmed payment state would be labeled `Confirmed`, but this UI has no confirmation mutation. The payment evidence drawer exposes the record returned by the existing list read. Rejecting a pending record requires a reason of at least ten characters in the interface and carries a request ID; a server migration must make that ten-character rule authoritative.

## Gaps and open questions

1. A list API with total count, page size 25, stable sorting, status counts, and filter metadata is needed for the requested numbered pagination and chips. The current RPC uses cursor pagination and returns no total.
2. Private application reads must expose actor display name and decision timestamp for `Approved by <name> on <date>`; verify whether the present JSON projection includes them before rendering.
3. Business lifecycle (`Active`, `Trial`, `Suspended`) is not established in the current read contract. Do not derive it from classification or contracts.
4. Private overview activity and live platform-health probes need authorized read models. Unknown remains the only safe health state until then.
   The current overview RPC supplies queue and stat values together, so individual attention/stat blocks cannot independently retry a failing field. The frontend separately reads the existing system-health resource and retries that panel on its own.
5. Payment confirmation, role changes, member removal, mark-all-read notification actions, suspension/restoration, and account recovery are unsupported. Their UI must be absent or clearly disabled.
6. A ten-character reject reason must be enforced server-side before that minimum can be promised as a platform invariant.
