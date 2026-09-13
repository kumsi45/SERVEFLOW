# Migration 261 deployment and post-deploy verification

TABLE OCCUPANCY FIX DEPLOYED AND VERIFIED

## A–C. Deployment, migration heads and effective function

Target linked Supabase project: `dbdhuuanfsniqvcyuscd`. Both the app API URL and private audit DB connection were checked against this reference. The pre-deploy remote head was 260; local history matched remote through 260, and 261 was the sole pending migration. The linked dry run listed only `261_public_qr_session_lookup_occupancy_side_effect_free.sql`.

Deployment used the installed Supabase CLI 2.107.0: `supabase db push --linked --yes`. It applied only 261 and exited successfully. No include-all, history repair, renumbering, squashing or manual migration-table write was used. Post-deploy Local 261 / Remote 261 was confirmed through the linked CLI and the remote migration table.

The migration file was not edited in this deployment task. Its SHA-256 before and after deployment was `eb0eb0b570734ea3c149d125040cce7a7fd9c81aaa032186bb96d6334dbcb549`.

Hosted `get_public_qr_order_session_p76_base(text,text,text,text)` source matched the validated migration body exactly (normalizing line endings only). It has no order/session INSERT, UPDATE, DELETE, expiry refresh, advisory write lock or auto-release call. Security-definer and `search_path=public` remain intact. Only the expected public three/four-argument overloads exist; the three-argument wrapper delegates to the four-argument wrapper, which delegates to the corrected helper. Effective public lookup EXECUTE access remains available to anon/authenticated; anon access to the hidden menu base, internal table sync and Owner stats remains denied. No grant broadening or RLS change was made.

## D–G. Live fixture occupancy, ordering and failure results

The post-deploy workflow suite used newly generated tenant/user/menu/table/shift fixtures in one rollback transaction. Unlike preparation mode, `--post-deploy` did NOT apply or replace the migration/helper.

- Valid scan logging, public menu load, repeated scans, two browser contexts, smart portal and public session lookup left zero order rows and Available occupancy.
- Both public lookup overloads returned truthful NULL when no session existed.
- First real QR order created one Occupied session with real items/invoice. Same-browser additional QR order reused the order ID and kept one session.
- First real Waiter table order occupied; additional Waiter order reused the same canonical session. QR-first then Waiter reused it; Waiter-first then unrelated QR was rejected without a duplicate.
- Cashier first order, active append and append-after-release fallback passed with canonical identity/history retained.
- Wrong, missing, inactive and cross-tenant QR submissions failed without occupancy. Invalid items left no order row. A materialized real-order RPC followed by an injected SQL failure rolled back order/invoice/items, leaving no phantom.
- Table number without a valid capability did not permit public occupancy; exact immutable table ID remained the lookup authority.
- Existing-session lookup retained its projection and left the complete fixture order JSON unchanged.

## H. Practical hosted concurrency verification

The separate `--post-deploy-concurrency` suite committed only newly generated removable fixture catalog/identity rows so two independent connections could see the same tenant/menu/tables. No test order, invoice, item or payment transaction was committed.

- Two independent concurrent public lookups both returned NULL, and the coordinator observed zero sessions.
- QR+QR and Waiter+QR first-order attempts used independent DB connections. The holder acquired the existing location lock; the contender ran the actual first-order RPC concurrently and was observed waiting for that advisory lock.
- The holder's real-order RPC created one session. Its additional order reused the same ID while contention continued.
- After holder rollback, the contender completed safely with one new active session in its own transaction, then rolled back. Each case left zero committed orders.
- The main post-deploy suite also verified both winner orderings, active-session reuse, and rejection of a competing cashier INSERT by existing unique active-session protection.

Limit: this tested real independent simultaneous lookup and real first-order lock contention with abort/handoff, not a committed-winner race with two fully committed order outcomes. All order transactions were deliberately rolled back. No locking/index protection was weakened. This limit is reported under the brief's safest-practical-concurrency allowance.

## I–K. Analytics, release and enablement

Scan count increased to two and last scan was populated while the table stayed Available; scan/menu access created no order. Public menu redaction and anonymous table enumeration denial passed. QR regeneration was tested only on a new rollback fixture table; old fixture QR failed, new fixture QR supported lookup and real ordering, and regeneration alone did not occupy it. No existing business/demo QR was rotated.

Paid invoice alone with unserved work stayed Occupied. Completed service alone with unpaid invoice stayed Occupied. Existing canonical payment/completion/release produced Available. Released history followed by a new QR order yielded a new ID and exactly one active session. Count reduction blocked a genuine unreleased session and allowed released history, preserving restaurant identity while detaching only the deleted table ID.

Disabled + existing unreleased session remained Disabled + Occupied. Disabled + no session remained Available. Inactive scan, lookup and ordering were rejected.

## L–M. Historical records and fixture cleanup

The seven historical empty public sessions across three restaurants were not reconciled, deleted, closed, cancelled, released, detached or otherwise written by this work. Before/after read-only fingerprints matched exactly:

- Full order-row fingerprint: `73b29df8f619c280ccf6f146e0d07527`.
- Full associated shift-activity-row fingerprint: `72e36f3f5ee683674227c6ec21f62040`.
- Population remained seven sessions / three restaurants.

The main workflow transaction rolled back all fixtures and explicitly verified absence of fixture restaurants and auth users, while verifying the deployed helper definition/ACL were unchanged after rollback. The concurrency suite rolled back both clients' order transactions, verified zero committed fixture orders, then deleted only its exact generated fixture tenants/users. Final assertions confirmed zero fixture residue. Migration 261 and its legitimate deployed helper change remained in place.

## N–P. Regressions, build and limitations

19 focused regression files / 181 tests passed after deployment: lookup migration/Owner authority, public QR/tracking/portal, Waiter ordering/lifecycle, Cashier settlement/obligations, canonical release, migration 260 security contracts, Tables 2A/2B/2C, development QR resolver, Owner stability and P1A/P1B/P1C. No unrelated tests were repaired.

`npm run build` passed TypeScript (`tsc -b`) and production Vite build; existing chunk-size warning remains. Both audit scripts passed `node --check`; `git diff --check` passed. The CLI-generated version-check cache was restored; no production UI or migration SQL was changed in this task.

Remaining limitations: committed-winner concurrent order certification as described above; no authenticated browser/physical-phone journey certified. Historical phantoms intentionally remain capable of reflecting Occupied until a separately authorized reconciliation plan exists. This deployment prevents the cause of new phantoms only.

No reconciliation, migration 262, RLS/security redesign, QR authority change, UI/navigation redesign, realtime/channel/polling change, lifecycle/payment redesign or Phase 2C.1.

Post-deploy verification commands:

- `node supabase/audits/table-occupancy-migration-validation.cjs --post-deploy`
- `node supabase/audits/table-occupancy-migration-validation.cjs --post-deploy-concurrency`
- `node supabase/audits/table-occupancy-migration-validation.cjs --effective`
- `node supabase/audits/table-occupancy-migration-validation.cjs --deployment-preflight`

Default preparation mode remains rollback-only. The explicitly named post-deploy concurrency mode temporarily commits only its generated fixture catalog/identities, then removes them; it must not be used under a rollback-only authorization.
