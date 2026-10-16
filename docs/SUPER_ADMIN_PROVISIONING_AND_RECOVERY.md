# Private administrator provisioning and recovery — not executed

No hosted administrator, invitation, factor or secret was created during SA2.
This procedure needs separate target-specific approval before use. It is not a public endpoint or a dashboard feature.

## Initial provisioning

1. First verify the intended project, effective Auth schema, migrations 276/277, RPC grants, private schema non-exposure and JWT issuer. Use the approved isolated baseline first. The persistent printer/workspace stack is not that baseline.
2. Select an existing, individually verified Auth identity. Verify email ownership and absence of a ban. Do not derive privilege from email strings, tenant role, signup metadata or profile fields. Never share the founder's password.
3. Using trusted, target-bound administration tooling, have that person enroll and verify a TOTP factor with Auth. The UI intentionally does not provide public enrollment/provisioning. Verify `auth.mfa_factors` and a live AAL2 session. Do not export the enrollment secret or recovery codes into this dashboard, screenshots or logs.
4. Agree and verify the recovery procedure out of band: named recovery verifier, independent identity evidence, verified recovery contact, session revocation and a controlled recovery drill. A password-reset email alone is insufficient. Record the non-secret approval evidence outside this repository.
5. A separately authorized database owner creates the `platform_private.administrators` row, initially inactive, for that exact verified Auth UUID. Start with Inspect only. No service-role/browser bootstrap endpoint exists. Verify operator identity and target before the transaction. The operator's infrastructure audit must record the bootstrap; it is not falsely represented as an `auth.uid()`-authenticated dashboard event.
6. Only after steps 2–4 are evidenced, record `recovery_verified_at` and enable the named row. Grant Manage or Sensitive separately on least-privilege evidence. Do not perform this process against a live target under SA2 authorization.
7. Sign in through `/platform-admin/login`; complete TOTP. Confirm `get_platform_admin_context`, access auditing and an Inspect read. Verify a tenant owner, revoked admin and AAL1 session are rejected by direct RPC calls. Sensitive operations require server-verified TOTP within five minutes; token refresh is not fresh MFA.

Current SQL checks active private authorization, recovery attestation, AAL2, an existing Auth session and a currently verified TOTP factor. Effective database execution and the actual recovery drill are UNVERIFIED until performed in the approved environment. Recovery attestation is not cryptographic proof of a drill.

## Emergency recovery

- No public bypass, temporary master password, SQL console or administrator self-promotion UI is enabled.
- Confirm the incident and administrator identity through the agreed independent verifier and target-specific approval.
- A trusted operator deactivates the affected private authorization before recovering identity/factors. Preserve records; do not delete the Auth user or tenant history.
- Revoke sessions using approved Auth administration tooling. Recover/re-enroll factors through the verified process; require a new recovery review before reactivation.
- Record the operator, approvals, safe change summary, times and outcome in the infrastructure incident record. On restored access, record the platform review. Never claim a failed database transaction logged its own rollback.
- Re-run direct authorization tests and review recent platform audit events. No restoration, secret rotation or live recovery is authorized by this document alone.

## Disabled lifecycle boundaries

- Public owner signup is denied locally; the replacement trigger rejects metadata-driven owner provisioning. Existing identities/memberships are unchanged.
- Application intake awaits approved retention. Trusted data migration/import is not authorized by this runbook.
- Invitation records are delivery-disabled intents. Tokens are not issued; digest/expiry/consumption must remain null until a separately reviewed implementation enables secure delivery and acceptance.
- Trial/readiness activation, contract/payment approval, renewal/reversal, suspension/restoration, reminder delivery and all recovery mutations remain unavailable.
- The contract ledger constrains seven-day trial and 365×24-hour annual intervals; it does not enforce existing operational RPCs. No expiry cutover flag or dashboard toggle exists.
- Do not enable those workflows by manually inserting entitlement rows. Complete cross-surface enforcement and reviewed tenant reconciliation first, without repurposing printer resources.
