# ServeFlow Super Admin visual preview report

Date: 2026-10-18  
Status: **LOCAL DEVELOPMENT PREVIEW USABLE — PRODUCTION ROUTE BLOCKED**

## Why the dashboard was previously inaccessible

The existing login route is `/platform-admin/login`. Every protected `/platform-admin/<section>` route initializes the dedicated Supabase browser client and requires all of the existing controls before it renders the workspace:

1. an authenticated Supabase session created with email and password;
2. a privately provisioned `platform_private.administrators` authorization for the exact Auth identity;
3. recorded recovery verification;
4. a verified TOTP factor and AAL2 session;
5. a successful `get_platform_admin_context` server check.

The repository does not expose public administrator signup, TOTP enrollment, recovery, or privilege bootstrap. The current target has not been approved and provisioned for founder access, so the private dashboard correctly remained behind its login/recovery/MFA gates.

## Local preview route

Run:

```text
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open:

```text
http://127.0.0.1:5173/platform-admin/preview
```

Section routes use `/platform-admin/preview/<section>`. The normal `/platform-admin/login` and `/platform-admin/<section>` behavior remains unchanged.

## Reused implementation

The preview renders the existing `PlatformAdminPage` shell, header, responsive sidebar/drawer, section content, filters, tables, pagination, tabs, dialogs, forms, metrics, panels, loading/error/empty states, notes, and accessibility hooks. It does not maintain a second dashboard implementation.

The preview adds only:

- a development-only route and lazy fixture module;
- a prominent `PREVIEW — SYNTHETIC DATA` banner;
- a display-state selector for populated, loading, empty, and error views;
- synthetic preview navigation paths;
- local no-op submissions for existing review dialogs;
- small responsive styles for the banner and preview controls.

## Sections available

All 14 implemented sections are navigable:

1. Overview
2. Applications & Approvals
3. Hospitality Businesses
4. Users & Invitations
5. Trials & Contracts
6. Payments & Renewals
7. Notifications
8. System Health
9. Errors & Diagnostics
10. Integrations
11. Backups & Recovery
12. Audit Logs
13. Administrators & Access
14. Security & Recovery

Users & Invitations also exposes its existing invitation-intent tab. Business classification and payment/application review dialogs can be opened and completed as synthetic local no-ops. The existing UI has no separate badge component; status and classification values remain the existing table text.

## Synthetic data rules

Fixtures are deterministic and visibly use `Synthetic`, `Preview`, `.invalid` email addresses, zero-style fixture UUIDs, and the source label `Synthetic preview fixture — not platform data`. Metrics are explicitly described as layout-review fixtures.

No fixture claims to represent a customer, payment, contract, administrator, production incident, backup result, integration state, or operational metric. Missing or unsupported platform capabilities retain the existing unavailable/unknown wording.

## Security safeguards

- Route parsing recognizes `/platform-admin/preview` only when `import.meta.env.DEV` is true.
- The lazy preview module import is also selected only in development.
- `PlatformAdminPage` throws if preview props are supplied outside development.
- The fixture module imports no Supabase client, privileged service, RPC helper, Edge Function, or fetch API.
- Preview initialization exits before Auth client/session setup.
- Preview reads come only from in-memory deterministic fixtures.
- Review-form submission exits through a visible no-op result before any `adminMutation` call.
- Preview header controls do not call MFA or sign-out APIs.
- The production bundle contained no preview route, preview module, synthetic business fixture, or preview fixture source string.
- A browser served from the production build opened `/platform-admin/preview` and received the normal `Menu link not found` UI with no preview indicator.
- Browser tests blocked and recorded cross-origin requests; none occurred during preview navigation or interactions.

Preview mode grants no session, role, authorization, MFA state, database access, or administrative capability. The existing private login, server authorization, recovery, MFA, and audit paths were not weakened.

## Desktop and mobile verification

Actual Chromium browser runs checked widths 320, 375, 768, 1024, and 1440 pixels. At every width:

- the page and body had no horizontal overflow;
- the preview banner and controls were readable;
- the current section heading rendered;
- tables stayed within their intentionally scrollable region;
- all 14 routes rendered;
- no platform or external request was made.

At mobile width, the focus-managed navigation drawer opened, moved focus to its close control, closed with Escape, and the skip link moved keyboard focus to main content. At desktop width, the full sidebar remained visible. The existing modal focus behavior and synthetic form submission were exercised.

The 320px and 1440px screenshots were inspected directly. No blocking clipping, overlap, unreadable contrast, or page-level overflow was observed. Verification used Chromium desktop and mobile projects; Safari/WebKit and physical devices were not tested in this phase.

## Verification results

| Check | Result |
| --- | --- |
| `npx vitest run tests/unit/platform-admin-preview.test.ts tests/unit/platform-admin.test.ts --reporter=default` | **PASS — 21 tests, 2 files** |
| `npm run build` | **PASS — TypeScript and Vite production build** |
| Development preview, desktop Chromium | **PASS — 8 passed, 1 production-only test skipped** |
| Development preview, mobile Chromium | **PASS — 8 passed, 1 production-only test skipped** |
| Production-served route guard | **PASS — 1 test** |
| Existing authenticated platform-admin regression, isolated rerun | **PASS — 16 tests** |
| `git diff --check` | Recorded in final review |

One earlier existing-regression run was interrupted because two Playwright processes attempted to share the same configured port and one runner shut down the reused server. It produced 12 passes and four infrastructure failures. The suite was rerun alone and all 16 tests passed.

## Files changed

- `src/app/router/AppRouter.tsx`
- `src/modules/super-admin/PlatformAdminPage.tsx`
- `src/modules/super-admin/PlatformAdminPreviewPage.tsx`
- `src/modules/super-admin/platformAdmin.css`
- `tests/unit/platform-admin-preview.test.ts`
- `tests/e2e/platform-admin-preview.spec.ts`
- `docs/SUPER_ADMIN_UI_PREVIEW_REPORT.md`

No migration, database configuration, environment file, hosted resource, account, printer resource, public-site component, Owner/Manager dashboard, deployment, or Git history was changed. SA3.3F remains paused and its report was preserved.

## Remaining limits

- This phase proves a local visual preview and production route exclusion. It does not prove backend readiness or grant founder access.
- Real administrator data, authorization, MFA, server RPCs, and mutations remain governed by the existing private flow.
- Browser verification covered Chromium emulation rather than Safari/WebKit or physical mobile devices.
- Table status values use the existing text presentation because the current dashboard has no badge component to reuse.
