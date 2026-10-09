# Printer P3.2 security and deployment readiness review

Status: **INCOMPLETE — DO NOT DEPLOY**. This review is of the local worktree only. Nothing was deployed or tested with production identities. Migration 273 remains unchanged and its SHA-256 is `1AC98CD9C7974DD269F20955865129F6980AEB1B802AEBEBB06EBB64284B5CD5`.

## Findings

| Severity | Finding and evidence | Required closure |
| --- | --- | --- |
| High, open | No isolated Supabase Auth/database/Edge environment or isolated Upstash instance was configured in this worktree. The local Supabase stack was not running. Mocked ports and Deno type checks cannot establish that Auth Admin, bytea RPC arguments, JWT gateway behavior, CORS preflight, Redis `EVAL`, revocation, or reconciliation work together. | Run the full lifecycle and failure matrix in a separate project with disposable identities and a separate rate limiter. Record HTTP status, SQL state, agent rows, Auth identities, and cleanup evidence. |
| High, open | Public `redeem` consumes one shared `redeem-global` budget of 600/hour before checking pairing ID or proof. An unauthenticated caller can exhaust it and block legitimate bridge setup. `start-global` has the same shared-budget availability property after a valid setup token. Digest-key rotation resets these global Redis buckets. | Add a trusted per-source abuse control at the gateway, size global limits to expected traffic, alert on saturation, and verify rotation behavior. Do not trust client-supplied IP headers without a verified proxy boundary. |
| High, open | One-time setup-token enforcement depends on the Redis replay key remaining available until token expiry. A Redis flush/eviction loses that record. The Owner-to-bridge setup channel is not implemented, so theft and transfer handling cannot be certified end-to-end. | Require a non-evicting isolated Redis configuration and failure alert; test restart/eviction behavior. Implement and review the setup channel before pairing is exposed to operators. If durable one-use cannot be guaranteed externally, propose a separate Migration 274; do not change 273. |
| Medium, open | Reconciliation is a protected endpoint, but no scheduler, orphan alert, or runbook has been configured. Bound identities after a lost credential response are intentionally retained and need Owner revocation/re-pair. | Configure a trusted schedule, alert on failures and unbound orphans, define operator triage, and test that bound users are never deleted. |
| Medium, open | Windows protected session storage and the local setup UX do not exist. A credential response is single-use at the SQL gate and marked `no-store`, but secure receipt and persistence by the bridge remain unverified. | P3.3: implement service-account-protected storage, secure setup exchange, and interruption/re-pair tests before operational use. |
| Fixed locally | The setup-token replay bucket originally changed when the current digest key rotated. A retained old token could therefore be used again. It now derives the replay bucket with that token's signing key version; a regression test checks both the core and Redis key. | Re-run against an isolated real Redis instance. |
| Fixed locally | Owner `OPTIONS` built a 204 response with a JSON body, causing the Response constructor to reject it. The HTTP helper now emits a bodyless 204; a direct test covers this. | Verify actual gateway preflight with the Owner function's JWT policy in an isolated Edge environment. |

## Confirmed source-level boundaries

- `supabase/config.toml` disables gateway JWT verification only for `print-bridge-pair` and `print-bridge-reconcile`. The Owner function retains default JWT verification and calls `auth.getUser` again. Its authorization uses the authenticated user ID, an active `restaurant_staff` Owner row, and Migration 273's Owner check. The public bridge handler requires a signed Owner setup token to start and a high-entropy proof to redeem. The maintenance handler requires a separate long secret. No endpoint accepts a supplied Owner user ID as authentication.
- Migration 273 receives only 32-byte code/proof digests, atomically changes pending to approved to redeeming to completed, and registers the agent with the dedicated Auth user. The service-only pairing RPC grants and authenticated Owner revoke/cancel grants match the adapter's calls. The bridge receives a dedicated access/refresh session, never the service-role key.
- The backend catches failed Auth provisioning, deletes a known unbound identity, marks the pairing failed where possible, and can reconcile ambiguous orphan creation through deterministic email and Auth metadata. A completed pairing cannot replay credentials. Cancellation during provisioning prevents binding. Database agent revocation precedes Auth banning, so an unexpired JWT still fails P2/P3.1 active-agent checks.
- These are source and mock-test findings. Real RPC execution, Auth behavior, Redis persistence, and hosted gateway policies remain unverified.

## Required isolated integration matrix

Use a dedicated Supabase project and separate Upstash database. Create only disposable Owner/restaurant and bridge identities. Capture cleanup proof after each case. Test successful Owner initiation, bridge start/approval/redemption, wrong tenant and user, wrong/expired/cancelled proof, five code guesses, setup-token replay across key rotation, two concurrent redemption clients, Auth create success with SQL completion failure, ambiguous Auth create, SQL completion with lost HTTP response, timeout retry, Owner cancellation during redemption, reconciler race, Redis outage/flush, Owner revoke while a JWT remains valid, and failed Auth ban retry. Include gateway `OPTIONS` and CORS behavior. Do not use `.env.local` as an isolated-test credential source.

## Secret and operational checklist

- Configure project secrets `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PRINT_BRIDGE_DIGEST_KEYS`, `PRINT_BRIDGE_EMAIL_DOMAIN`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `PRINT_BRIDGE_OWNER_ORIGIN`, and `PRINT_BRIDGE_MAINTENANCE_KEY`. None may be placed in `VITE_` variables or bridge packaging.
- Generate independent high-entropy digest and maintenance keys. Use an exact HTTPS Owner origin and an isolated TLS Redis REST endpoint. Keep old digest versions only through the maximum outstanding pairing lifetime plus rollout margin; confirm the replay budget stays stable during rotation. Rotate service, Redis, and maintenance credentials through their respective providers without printing them in logs.
- Use Redis with no eviction of live replay keys. Monitor availability, global-budget saturation, 429/503 rates, and pairing provisioning failures. Treat Redis outage as fail-closed; do not bypass limits.
- Schedule reconciliation with its maintenance header from a trusted scheduler, monitor nonzero orphan counts and errors, and retain completed/bound identities. Review Auth pagination limits before scale-up.
- P3.3 owns the Owner-to-bridge setup channel, protected Windows credential storage, bridge health and print transport. P3.2 must validate its backend lifecycle and operational dependencies before any controlled backend deployment.

## Controlled deployment and rollback plan (not executed)

1. Close the findings and isolated matrix. Review exact Edge secrets, gateway function policies, and scheduler permissions. Keep frontend and printer service deployment deferred.
2. Deploy only the three reviewed backend functions in a controlled window, confirm their function-specific JWT policies, and run a disposable tenant smoke test. No migration deployment is planned.
3. Watch 429/503, Auth orphan, and pairing event metrics. If failures or authorization anomalies occur, disable Owner initiation and bridge start/redeem at the gateway or roll back the functions to the prior disabled state. Preserve reconciliation for cleanup.
4. Enumerate agents created during the window. Revoke affected agents through the Owner path, ban their Auth users, allow existing P2 leases to expire, and verify no new claims or acknowledgements succeed. Preserve database audit events and investigate before re-enabling. Rotate project secrets only if exposure is suspected; do not rotate the global service-role key as a routine rollback action.

**Recommendation:** Security review incomplete. Do not deploy P3.2 until isolated integration, public-endpoint abuse controls, replay-store durability, scheduler/alerts, and gateway behavior are certified.
