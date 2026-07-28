# Phase 9 production canary

Date: 2026-07-28 (Africa/Nairobi), refreshed for Phase 9.11

Project: `dbdhuuanfsniqvcyuscd`

Latest AI canary slug: `phase9-canary-1785265703739` (cleaned up)

## Result

PARTIAL — the Phase 9.11 architecture and hosted starter adapter pass, while the configured AI provider remains unavailable.

## Steps executed

1. Create Restaurant — PASS. The deployed `owner-signup` function created an authenticated owner and isolated canary restaurant.
2. Upload Paper Menu — PASS. A 37,586-byte PNG paper-menu image was uploaded to the private `menu-import-drafts` bucket and registered through `menu_import_drafts`.
3. AI Menu Import — FAIL with the safe owner message `We couldn't create your digital menu.` The uploaded source remained available. Provider details were not exposed.
4. Review Studio — NOT RUN because AI Menu Import produced no draft.
5. Generate AI Images — NOT RUN.
6. Preview and Menu Health Check — NOT RUN.
7. Publish — NOT RUN.
8. Restaurant Dashboard — NOT RUN.
9. Open Live Menu — NOT RUN.
10. Scan QR / Customer Menu — NOT RUN.

## Cleanup

The uploaded object, menu draft, application user, staff membership, restaurant tables, restaurant, and Auth user created for the failed canary were removed. The canary slug no longer exists.

## Smart Starter Menu certification

`node supabase/audits/phase9-production-canary.mjs --starter-draft` passed against the linked project. It created seven items in a private `ai_menu_import_drafts` Review Studio draft with `source_kind = starter`, verified owner visibility, created no production menu rows through the adapter, and removed the isolated canary restaurant afterward.

## Exact reproduction

From the repository root with the linked production project and `.env.local` configured:

```powershell
node supabase/audits/phase9-production-canary.mjs
```

The audit stops at the first failed production dependency and emits one `CANARY_RESULT` JSON record without printing credentials.

## Required remediation

Restore quota/billing for the configured `OPENAI_API_KEY`, or configure another implementation behind `MENU_AI_PROVIDER`. Then rerun the canary from step 1 until all ten steps pass.
