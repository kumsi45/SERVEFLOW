# SA2 execution checklist

Baseline: clean `main`, `f55974a55ebbefa599881b1f62fe2b3b04b7f623`.
SA1 evidence: completed conversation report; no saved SA1 report found in `docs`.

- [x] Separate administrator identity/session, MFA/recovery gates and private audit ledger in code/candidate SQL.
- [x] Authorized overview, paginated business/application/user/audit views and reversible classification in code.
- [x] Durable application decisions, invitation intents, payment reviews and fixed-duration contract foundation in candidate SQL.
- [x] Honest health, diagnostic, integration and backup views; unsupported actions disabled.
- [x] Close local signup/global-setting bypasses without changing existing account login.
- [x] Safe automated checks, diff review and implementation report (`SUPER_ADMIN_SA2_REPORT.md`).
- [ ] Real PostgreSQL/RLS/concurrency/MFA integration verification — BLOCKED, not passed by UI/source tests.

Database integration is blocked: the running `workspace` Supabase services and `p322` Edge runtime belong to the previously identified persistent printer/workspace environment. No separate verified disposable baseline is available. Do not apply SQL or create fixtures there.
No deployment, hosted migration, live administrator provisioning, printer work or destructive cleanup is authorized.
