# Platform administration redesign plan

Date: 2026-10-18. The detailed source and route inventory is in [ui-audit.md](ui-audit.md). This plan governs the local frontend redesign; it does not certify hosted database behavior.

## Stage 0 baseline

| Check | Observed result before UI changes |
| --- | --- |
| `npm run lint` | Exit 1: `npm error Missing script: "lint"`. The project has no lint script. |
| `npx tsc --noEmit -p tsconfig.json --incremental false` | Exit 0. |
| `npm test -- --reporter=default` | Exit 1: 230 files, 224 passed, 5 failed, 1 skipped; 1,759 tests, 1,737 passed, 6 failed, 16 skipped. Failures are existing Owner and Inventory source assertions in `phase-w5-inventory-tracking-workflow`, `owner-operations-experience`, `phase-w6-v1-recipe-inventory-workflow`, `owner-performance-p1b` (2), and `theme-engine-foundation`. |
| `npm run build` | Exit 0. Vite built 2,360 modules in 4.33 seconds. |

## Scope and architecture

React, TypeScript, Vite, scoped CSS, Supabase browser client, Vitest, and Playwright are already present. `AppRouter` exposes 14 section keys under both `/platform-admin/:section` and a development-only `/platform-admin/preview/:section`; `/platform-admin/login` is the private Auth/MFA/recovery gate. The sections are overview, applications, businesses, users, contracts, payments, notifications, system-health, diagnostics, integrations, backups, audit-logs, administrators, and security. `/platform-admin/preview` defaults to overview. There are also in-page invitations and record dialogs.

The current page owns the header, sidebar, page header, filters, table, dialogs, loading, error, and pagination. `PlatformAdminWorkspace` owns navigation, section tabs, badges, and overview. `PublicThemeToggle` and `useModalFocus` are shared outside this module. `platformAdminService` owns private RPC access. Retain the private client and permissions, and provide one typed resource boundary with a separate development-only in-memory adapter.

The audit identifies embedded rules around private administrator identity, fresh MFA and verified recovery, disabled invitation delivery and provisioning, classification as a reviewed label, disabled suspension and restoration, manual payment review, disabled notification delivery, no backup restoration control, and unknown service health. These remain truthful in the UI and are documented as server rules or capability gaps in `backend-contract.md`.

## Token mapping

| Existing token or style | Intended token and use |
| --- | --- |
| `--pa-bg` | Page surface, light `#f6f8f7`, dark `#101a16`. |
| `--pa-surface` | Content surface, light `#ffffff`, dark `#1a2921`. |
| `--pa-soft` | Raised or quiet hover surface, light `#eaf0ec`, dark `#26392e`. |
| `--pa-line` | One visible divider/border token; increase contrast from audit's 1.29:1 light and 1.54:1 dark. |
| `--pa-ink`, `--pa-muted` | Primary and secondary text, each checked against its actual surface. |
| `--pa-brand` | Focus, active navigation, and primary action only. |
| `--pa-positive`, `--pa-warning`, `--pa-negative` and backgrounds | Success, pending, and destructive meaning respectively. Unknown/demo use neutral. |
| Current 8-11px labels, 10px headers, 650-800 weights | 12/16 label, 13/18 secondary, 14/20 body, 18/24 section, 28/32 title, 32-36 KPI; 400/500/600 weights. |
| Existing 5-16px radii, card shadows | Two radii (8 and 12px); shadows for overlays only. |

Existing `--pa-*` names remain during migration to avoid an all-at-once CSS break. Remove unused aliases by Stage 8; record any survivors then.

## Component inventory

| Decision | Components |
| --- | --- |
| Consolidate existing markup | Button, StatusBadge, SearchInput, Select, DataTable, Pagination, ConfirmDialog, PageHeader, StatTile, AttentionList, EmptyState, ErrorState, Skeleton. |
| Build within the admin module where supported | FilterChip, drawer/sheet, Tooltip, Breadcrumb, Tabs, ActivityFeed, HealthList, Toast, BottomTabBar, AccountMenu, DemoBanner. |
| Leave and reuse | `PublicThemeToggle`, `useModalFocus`, admin authentication/context, private RPC service, other product modules. |

Each interactive component must cover keyboard, loading, disabled, empty, and error states where applicable. A page must not claim a capability merely because a component can render it.

## Decisions where repository evidence changes the defaults

1. The backend exists in source: `platformAdminService.ts` calls protected Supabase RPCs, and migrations define platform-admin behavior. Keep that path. Synthetic data is confined to the development-only preview, and private data remains subject to existing authorization. Deployment of the migration is unverified.
2. The private UI already supports sign-out and MFA re-verification. Retain those account actions; the demo cannot perform them and should not pretend it can.
3. Application decisions currently require a reason on the server for both approval and rejection, with audit fields. The requested ten-character rejection minimum can be applied in the UI; do not loosen the private server rule or imply that only rejection is audited.
4. Payment confirmation and user role/removal mutations are not exposed by the checked-in client. Show actual available review actions and document missing capabilities instead of fake buttons or saved states.
5. The private overview has nullable totals and no live activity or service probes. Display `Unavailable` or `Unknown` where appropriate. No count can be inferred from a paged list.
6. Canonical visible vocabulary: Business, Application, Status, Classification, Contract, Payment, Member, Administrator. Business lifecycle `Active / Trial / Suspended` is a requested future model; the current RPC exposes classification but no verified lifecycle field, so the UI must not manufacture one.

## Stage order and acceptance

1. Capture the baseline and six viewport/theme screenshots per route.
2. Introduce the typed data boundary and a preview adapter with latency, error, empty, partial, large-list, conflict, and in-memory mutation modes. Keep private calls behind the existing client.
3. Add coherent two-theme tokens and reusable admin controls; record measured contrast.
4. Rebuild the shell, overview, applications, businesses, and remaining pages in stage order. Preserve supported private actions.
5. Verify responsive and keyboard behavior, remove implementation copy, take after screenshots, and finalize the backend contract and gaps.

## Copy ledger

Populate as strings are changed. Initial candidates: `LOCAL PREVIEW · SYNTHETIC DATA` to `Demo data`; `Source: Synthetic preview fixture` removed from page bodies; `Preview controls` moved to a developer-only switch; page eyebrows and repeated subtitle paragraphs removed; `Decision` and `Verified` column terms changed to `Status` where they describe status. Policy paragraphs move to `backend-contract.md`, with only short action-relevant hints kept in the UI.

## Stage 2 design-system evidence

`PlatformAdminUI.tsx` contains the new control, table, dialog, feed, state, and navigation primitives; `platformAdminDesign.css` defines their shared visual rules in both themes. The old `--pa-*` names remain as aliases while existing page markup migrates. `StatusBadge` maps pending to amber, success/active to green, rejected/failed to red, and unknown/unavailable/demo/unclassified to neutral. Badge text carries the state independently of color.

Component states: Button supports five variants plus busy/disabled; inputs expose labels and error association; DataTable supports keyboard row activation and card mode; Pagination hides when a known result fits; Drawer and ConfirmDialog use the shared focus trap; Tooltip opens on hover/focus; states distinguish empty, loading, error/retry, toast, and demo. AccountMenu and BottomTabBar are containers for supported actions and navigation, not sources of new product capabilities. Page integration follows in Stages 3-8.

Measured specified-color contrast, calculated with WCAG sRGB relative luminance (before values are in the audit):

| Pair | Before | After |
| --- | ---: | ---: |
| Light border / surface | 1.29:1 | 3.21:1 |
| Dark border / surface | 1.54:1 | 3.98:1 |
| Light muted text / surface | 5.48:1 | 5.38:1 |
| Dark muted text / surface | 6.97:1 | 7.80:1 |
| Light brand / surface | 8.54:1 | 8.54:1 |
| Dark brand / surface | 9.86:1 | 10.05:1 |

The light border also reaches 3.01:1 against the page background; the dark border reaches 4.66:1. These are token-pair calculations, not a full element-by-element accessibility certification.
