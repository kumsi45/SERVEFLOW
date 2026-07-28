# Phase 9 production canary

Date: 2026-07-28 (Africa/Nairobi)

Project: `dbdhuuanfsniqvcyuscd`

Canary slug: `phase9-canary-1785257669040`

## Result

FAILED — Phase 9 is not production certified.

## Steps executed

1. Create Restaurant — PASS. The deployed `owner-signup` function created an authenticated owner and isolated canary restaurant.
2. Upload Paper Menu — PASS. A 37,586-byte PNG paper-menu image was uploaded to the private `menu-import-drafts` bucket and registered through `menu_import_drafts`.
3. AI Menu Import — FAIL. The deployed `menu-ocr-extract` function reached the configured OpenAI provider, which returned: `You exceeded your current quota, please check your plan and billing details.`
4. Review Studio — NOT RUN because AI Menu Import produced no draft.
5. Generate AI Images — NOT RUN.
6. Preview and Menu Health Check — NOT RUN.
7. Publish — NOT RUN.
8. Restaurant Dashboard — NOT RUN.
9. Open Live Menu — NOT RUN.
10. Scan QR / Customer Menu — NOT RUN.

## Cleanup

The uploaded object, menu draft, application user, staff membership, restaurant tables, restaurant, and Auth user created for the failed canary were removed. The canary slug no longer exists.

## Exact reproduction

From the repository root with the linked production project and `.env.local` configured:

```powershell
node supabase/audits/phase9-production-canary.mjs
```

The audit stops at the first failed production dependency and emits one `CANARY_RESULT` JSON record without printing credentials.

## Required remediation

Restore quota/billing for the configured `OPENAI_API_KEY`, or explicitly approve and configure a production OCR provider fallback. Then rerun the canary from step 1 until all ten steps pass.
