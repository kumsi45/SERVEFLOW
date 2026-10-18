# ServeFlow Super Admin UI redesign

Date: 2026-10-18  
Scope: local frontend and visual preview only

## Summary

The previous 14-link sidebar placed business work and technical operations at one level. The overview was a set of counters without a clear review queue, and the large preview banner displaced useful content. Tables and controls did not share a consistent visual hierarchy.

The redesigned workspace retains the existing protected routes, service calls, authorization gates, and 14 sections. Its primary navigation now contains Overview, Applications, Businesses, Subscriptions & Payments, Users & Access, and Notifications. System & Security expands to show seven operational and security sections. Contracts and Payments have their own tabs. The compact sidebar can collapse on desktop; a focus-managed drawer is used on mobile.

## Design and section changes

The Super Admin uses scoped light and dark design tokens, the existing ServeFlow theme preference and toggle, consistent cards, status badges, filters, tables, details dialogs, loading and empty states, and a compact synthetic-preview strip. The shared `PlatformAdminPage` renders both protected and preview routes; `PlatformAdminWorkspace` provides presentation components. No second dashboard was introduced.

| Section | Current presentation |
| --- | --- |
| Overview | Six metric cards, attention queue, preview-only activity, subscription summary and direct section links. Unsupported production metrics remain Unavailable. |
| Applications | Search, review status, readable records and details, and guarded approve/reject dialogs for pending records. |
| Businesses | Directory, classification filter, owner display, details panel and reviewed classification action. |
| Users & Access | Business members and invitations views, with Administrators & Access linked as a separate protected subsection. |
| Contracts & Trials | Contract dates and derived term timing, explicitly separate from payment or entitlement confirmation. |
| Payments & Renewals | Submitted-payment review status, details and guarded recording/rejection controls; no payment approval is implied. |
| Notifications | Reminder records and delivery status, without claiming that delivery is configured. |
| System Health | Plain-language service labels and observed-status badges; unknown checks remain unknown. |
| Errors & Diagnostics | Searchable diagnostic records and a details panel for technical references. |
| Integrations | Explicit unverified and unconfigured connection evidence. |
| Backups & Recovery | Unknown backup evidence and the existing restricted recovery explanation. |
| Audit Logs | Search, status and UTC date filters, with actor and request identifiers in details. |
| Administrators & Access | Administrator records and access states; no credential material. |
| Security & Recovery | Existing authorization and unavailable-capability explanations in the operational workspace. |

The preview fixture contains seven synthetic records per list section to exercise filters and pagination. It is visibly labeled `LOCAL PREVIEW · SYNTHETIC DATA`. Its controls expose populated, loading, empty and error states. Preview review forms give an explicit unsaved result and never call administrative services. Reviewed applications and rejected payments do not expose repeat decision buttons.

## Responsive and accessibility review

Actual Chromium browser checks covered 320, 375, 430, 768, 1024, 1280 and 1440 pixel widths. The overview, Applications, Businesses, Contracts, Payments, Users and System Health were captured in both themes at 320, 375, 768, 1024 and 1440 pixels. The 320px light overview, Applications and Payments screenshots and the 1440px dark overview and System Health screenshots were inspected directly. The Payments screenshot revealed a missing mobile status label; the table column name was corrected and a browser assertion for the label passed. No page-level horizontal overflow or remaining blocking clipping was observed. Narrow tables become stacked records, while the drawer closes on selection and Escape and restores focus. Dialog focus, skip navigation, keyboard theme switching and badge/heading contrast were exercised by browser tests. Reduced-motion styling is present.

Browser evidence is under `test-results/admin-redesign-resume/` and `test-results/admin-redesign-mobile-resume/`. Chromium emulation is not a physical iPhone, Android device, Safari or WebKit certification.

## Preview and production boundary

`/platform-admin/preview` is selected only in Vite development mode. The preview fixture is a development-only lazy import, and the shared page rejects preview props outside development. Preview initialization exits before the Supabase Auth client is used. Preview reads are local in-memory fixtures, and form submissions exit before `adminMutation`. Browser tests intercepted cross-origin requests and observed none in preview interactions. No Inspect, Manage or Sensitive privilege is granted.

The production build's JavaScript assets contain no synthetic fixture names, fixture source string, or preview route string. A browser served from that build opened `/platform-admin/preview` and received `Menu link not found`. The protected login, MFA, recovery, database authorization and audit paths remain in place. A production route test does not establish hosted database readiness or administrator provisioning.

## Verification

| Check | Observed result |
| --- | --- |
| `npx vitest run tests/unit/platform-admin-preview.test.ts tests/unit/platform-admin.test.ts --reporter=default` | 23 passed |
| `npm run build` | TypeScript and Vite production build passed |
| Desktop Chromium, preview and authenticated-path regression specs | 31 passed, one production-only test skipped in the development run before the final label correction |
| Final mobile status-label regression | 1 passed after the label correction |
| Mobile Chromium, drawer, directory and theme/contrast tests | 3 passed |
| Production-served preview route test | 1 passed; preview route blocked |
| Production asset search for preview route and synthetic fixture strings | No matches |
| `git diff --check` | Passed |

The authenticated-path browser regression uses isolated test responses; it does not certify a hosted administrator or database. The 14-section preview and private route tests ran locally. No SQL, migration, hosted resource, account, printer resource, Docker resource, deployment target, commit or push was changed for this redesign.

## Limits and next step

The current production overview RPC returns `null` for several requested business and contract metrics, so the UI honestly shows **Unavailable** for those values. Production recent activity also remains unavailable in the overview; the synthetic activity list exists only in the preview. No backend contract or lifecycle mutation was added in this frontend phase. Live database behavior, hosted permissions, physical devices and production service health remain unverified.

To review the UI locally, run `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort` and open `http://127.0.0.1:5173/platform-admin/preview`.
