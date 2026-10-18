# ServeFlow Platform admin UI: Phase 1 read-only audit

Date: 2026-10-18. Scope: the current Super Admin frontend, including the development preview. No source, routes, backend, migrations, permissions, or existing reports were changed by this audit. Evidence notation is `path:start-end`; screenshot evidence names refer to existing `test-results/admin-redesign-resume/` files. Short source names used below resolve to `src/modules/super-admin/PlatformAdminPage.tsx` (`Page.tsx`), `src/modules/super-admin/PlatformAdminWorkspace.tsx` (`Workspace.tsx`), `src/modules/super-admin/PlatformAdminPreviewPage.tsx` (`Preview.tsx`), `src/modules/super-admin/platformAdmin.css` (`platformAdmin.css`), `src/modules/super-admin/platformAdminService.ts` (`platformAdminService.ts`), `src/core/accessibility/useModalFocus.ts` (`useModalFocus.ts`), `src/modules/landing/components/PublicThemeToggle.tsx` (`PublicThemeToggle.tsx`), `src/app/router/AppRouter.tsx` (`AppRouter.tsx`), and `supabase/migrations/276_platform_admin_foundation.sql` (`276_platform_admin_foundation.sql`). A live, read-only Chromium pass measured rendered geometry without writing screenshots. “UNVERIFIED” identifies evidence that this phase could not obtain.

## 1. Executive summary

Ranked by severity, then estimated frontend effort:

| Finding | Severity | Effort | Evidence |
| --- | --- | --- | --- |
| The production overview cannot currently answer several founder questions: its UI asks for total businesses, active businesses, expiring contracts and trials, while the checked-in overview RPC returns `null` for related fields. Preserve **Unavailable**; do not infer values from visible rows. | High | M | `src/modules/super-admin/PlatformAdminWorkspace.tsx:65-82`; `supabase/migrations/276_platform_admin_foundation.sql:204-212` |
| At 390×844, the queue follows six KPI cards; its first row starts at 761px and extends past the first screen. Audit Logs' first record starts near the bottom of that screen. | High | M | `src/modules/super-admin/PlatformAdminWorkspace.tsx:81-87`; `src/modules/super-admin/platformAdmin.css:11-12,18`; existing `light-320-overview.png` |
| At 768px and 1024px the Business table splits `CLASSIFICATION`, `Owner association`, `Entitlement`, names, badges and timestamps across words. The page has no horizontal overflow, but the record layout is difficult to read. | High | M | `src/modules/super-admin/platformAdmin.css:13,17-18`; existing `light-768-businesses.png`, `light-1024-businesses.png` |
| Several visible targets are smaller than 44px: KPI arrow links 26–28×28, preview controls 32px high, policy summaries 36px high, operational submenu links 38px high, and the 390px Refresh button 38×44. | Medium | S | `src/modules/super-admin/platformAdmin.css:6-11,18`; `src/modules/super-admin/PlatformAdminWorkspace.tsx:82` |
| Operational navigation has its own scroll at 1440×900 when expanded; collapsed desktop mode leaves its subsection labels at 9px. | Medium | M | `src/modules/super-admin/platformAdmin.css:7-8`; `src/modules/super-admin/PlatformAdminWorkspace.tsx:36-50` |
| The primary workspace repeats the same application/payment/contract counts in the KPI grid and work queue. | Medium | S | `src/modules/super-admin/PlatformAdminWorkspace.tsx:67-85`; existing `light-320-overview.png` |
| Preview wording is distributed across route setup, fixture values, shell, dialogs, and footer. One presentation flag would not remove fixture text or preserve the compile-time production boundary by itself. | Medium | M | `src/app/router/AppRouter.tsx:26-43`; `src/modules/super-admin/PlatformAdminPreviewPage.tsx:4-69`; `src/modules/super-admin/PlatformAdminPage.tsx:89-94,186-198,224-236` |
| Tiny text is extensive: source declarations include 8, 9, 10 and 11px sizes. Text color pairs pass the sampled 4.5:1 contrast threshold, but the standard border token is only 1.29:1 on light and 1.54:1 on dark surfaces. | Medium | M | `src/modules/super-admin/platformAdmin.css:2-3,7-13,18`; contrast calculation below |
| The shared presentation is concentrated in one 240-line page with several long JSX lines, making copy and visual changes easy to couple to action controls. | Low | M | `src/modules/super-admin/PlatformAdminPage.tsx:42-240` |

## 2. Stack and architecture facts

React and TypeScript render a Vite app. `AppRouter` resolves paths itself from `window.location`, with lazy Super Admin page imports; no separate router package is used for this route. Styling is plain scoped CSS plus global CSS, not Tailwind, CSS modules, or CSS-in-JS. `lucide-react` supplies icons; there is no Super Admin component library. The admin CSS specifies `Inter, system-ui, sans-serif`, while global CSS has a broader fallback list; a bundled or remotely loaded Inter font was **UNVERIFIED**. Vitest and Playwright are installed; package scripts have no lint command. Evidence: `package.json:1-38`; `src/app/router/AppRouter.tsx:26-43,151-157`; `src/modules/super-admin/platformAdmin.css:1-3`; `src/styles/global.css:1-8`.

The private page uses a dedicated Supabase browser client, then an administrator context check; the development preview feeds the same page a local `read` function and separate path generator. This maps the UI boundary only. Hosted authorization and migration application are **UNVERIFIED**. Evidence: `src/modules/super-admin/platformAdminClient.ts:1-15`; `src/modules/super-admin/PlatformAdminPage.tsx:66-107`; `src/modules/super-admin/PlatformAdminPreviewPage.tsx:63-69`.

## 3. Route and component inventory

All 14 section paths below have the same `PlatformAdminPage` shell and are reachable via the sidebar's main or expanded operational navigation; the section tabs additionally expose Contracts/Payments and the operational siblings. The protected prefix is `/platform-admin/`; the preview prefix is `/platform-admin/preview/`. Evidence: `src/app/router/AppRouter.tsx:31-43,155-157`; `src/modules/super-admin/PlatformAdminWorkspace.tsx:14-18,36-56`; `src/modules/super-admin/PlatformAdminPage.tsx:184-200`.

| Section path | Page/content source | Navigation | Extra view |
| --- | --- | --- | --- |
| `overview` | `PlatformAdminWorkspace.tsx:65-95` | Main | KPI, queue, activity, subscription panel |
| `applications` | `PlatformAdminPage.tsx:19-21,206-218` | Main | Review dialog |
| `businesses` | `PlatformAdminPage.tsx:19-20,206-218` | Main | Detail and classification dialogs |
| `users` | `PlatformAdminPage.tsx:22-23,205-218` | Main | Members/Invitations tab |
| `contracts` | `PlatformAdminPage.tsx:24,212-218` | Main group and tab | Term timing |
| `payments` | `PlatformAdminPage.tsx:25,213-218` | Contracts group tab | Record/reject dialogs |
| `notifications` | `PlatformAdminPage.tsx:26,206-218` | Main | Record details |
| `system-health` | `PlatformAdminPage.tsx:220` | Operations | Service panel |
| `diagnostics` | `PlatformAdminPage.tsx:29,206-218` | Operations | Technical references |
| `integrations` | `PlatformAdminPage.tsx:221` | Operations | Evidence panel |
| `backups` | `PlatformAdminPage.tsx:222` | Operations | Readiness panel |
| `audit-logs` | `PlatformAdminPage.tsx:27,206-218` | Operations | Date filters and details |
| `administrators` | `PlatformAdminPage.tsx:28,206-218` | Operations and Users tab | Detail panel |
| `security` | `PlatformAdminPage.tsx:223` | Operations | Boundary panel |
| `/platform-admin/login` | `PlatformAdminPage.tsx:158-174` | Header exit from preview only | Login/MFA/recovery states |
| `/platform-admin/preview` | `AppRouter.tsx:33-38`; `PlatformAdminPreviewPage.tsx:63-69` | Direct local URL | Defaults to overview |

There are no separate section detail routes: details and reviews are dialogs in `PlatformAdminPage.tsx:226-238`. The mobile sidebar is also a dialog-like drawer in `PlatformAdminPage.tsx:189-195`. The old `/admin` path is retired, not a second dashboard (`AppRouter.tsx:31-32,155`).

| Shared presentation/behavior | Definition | Render sites in Super Admin source | Variants and duplication |
| --- | --- | ---: | --- |
| Header/sidebar shell | `PlatformAdminPage.tsx:184-197` | 1 shell reused for all 14 routes | Preview/private controls differ; brand and workspace identity repeat. |
| WorkspaceNavigation | `PlatformAdminWorkspace.tsx:38-51` | 1 | Main vs expandable operations; active state from `section`; no count props. |
| WorkspaceTabs | `PlatformAdminWorkspace.tsx:53-57` | 1 | Contracts/Payments, Users/Administrators, operations. |
| PlatformOverview/cards | `PlatformAdminWorkspace.tsx:65-95` | 1 | Six KPI cards, queue, preview-only activity, summary; card markup stays local to overview. |
| StatusBadge | `PlatformAdminWorkspace.tsx:59-63` | 3 JSX sites in page | Positive, negative, attention, neutral from a text regex. |
| Table/filter/pagination | `PlatformAdminPage.tsx:179-183,205-218` | 1 generic site each | Ten record shapes chosen by `columns`; preview/private data same layout. |
| Dialogs | `PlatformAdminPage.tsx:226-238` | 2 | Detail vs consequential review; no standalone modal component. |
| Focus trap/return | `useModalFocus.ts:16-79` | 3 calls in page | Drawer, detail, action. |
| Theme toggle | `PublicThemeToggle.tsx:20-47` | 1 in admin header | Reuses public preference; no admin-only theme store. |
| Empty/loading/error | `PlatformAdminPage.tsx:203-217`; `PlatformAdminWorkspace.tsx:88-90` | Generic list empty, skeleton, error/retry; overview activity empty | Preview has explicit populated/loading/empty/error controls. |
| Tooltip | `PlatformAdminWorkspace.tsx:46-49` | HTML `title` on nav | No custom tooltip component. |

Buttons and form controls are native HTML styled by `.pa-root` rules, not shared React components (`PlatformAdminPage.tsx:205-238`; `platformAdmin.css:4`). Similar `Unavailable` rendering exists in `display`, `metric`, `StatusBadge`, and `contractTiming`; they have different data purposes but could share a presentational vocabulary. Evidence: `PlatformAdminPage.tsx:17-18`; `platformAdminService.ts:24-25`; `PlatformAdminWorkspace.tsx:6-12,59-63`.

## 4. Preview scaffolding map and flag verdict

| Occurrence | Current control | Evidence |
| --- | --- | --- |
| Route and lazy fixture module | `import.meta.env.DEV` gates route parsing and import | `src/app/router/AppRouter.tsx:26-43,155-157` |
| Direct preview prop | Shared page throws outside development | `src/modules/super-admin/PlatformAdminPage.tsx:11-15,42-43` |
| Auth/read/mutation forks | `preview` prop skips Auth, calls fixture reader, and exits before mutations | `PlatformAdminPage.tsx:72-107,142-150` |
| Fixture names, owner, entitlement, source, timestamps, metrics and activity | Hard-coded in development-only fixture module, not one UI flag | `PlatformAdminPreviewPage.tsx:4-60` |
| Header exit, identity footer, compact strip and controls | Conditional JSX on `preview` | `PlatformAdminPage.tsx:186-198` |
| Detail/review warnings and result | Conditional JSX and local no-op | `PlatformAdminPage.tsx:144,226-236` |
| Footer source | Always rendered when `data` exists; fixture supplies preview-specific text | `PlatformAdminPage.tsx:224`; `PlatformAdminPreviewPage.tsx:5` |
| Existing production verification | Earlier report records a production route/browser check, not a fresh hosted check in this audit | `docs/SUPER_ADMIN_COMPLETE_UI_REDESIGN_REPORT.md:1-66` |

**Verdict:** a single `PREVIEW_MODE` presentation flag could centralize the visible warnings, but it cannot safely replace the compile-time `DEV` route/import guard or the distinct fixture data and auth/mutation branches. Removing every `Synthetic` prefix is a fixture-copy decision, not merely a switch. Production source still contains conditional preview strings in the shared component; the fixture module and route were absent from the previously inspected production build. A new production build was **UNVERIFIED in this read-only phase**. Evidence: `AppRouter.tsx:26-43`; `PlatformAdminPage.tsx:42-43,72-107,142-150,186-198`; `PlatformAdminPreviewPage.tsx:4-69`.

## 5. Token audit and contrast results

Counts below are literal declaration occurrences in `platformAdmin.css`, including media overrides; color-token occurrence counts include the light and dark definitions. They are source counts, not unique rendered element counts. All admin colors and breakpoints are in this one scoped file. Evidence: `src/modules/super-admin/platformAdmin.css:1-20`.

| Token/value | Count | Defined/used |
| --- | ---: | --- |
| `--pa-ink` light `#1c3029`, dark `#e2ebe5` | 12 | CSS lines 2-3; headings, controls, text |
| `--pa-muted` `#5c6d65` / `#a3b6aa` | 30 | CSS lines 2-3; labels, helper text, disabled controls |
| `--pa-line` `#dce5df` / `#34493d` | 23 | CSS lines 2-3; borders and separators |
| `--pa-surface` `#fff` / `#192b22` | 17 | CSS lines 2-3; header, cards, tables, dialogs |
| `--pa-bg` `#f5f7f6` / `#112018` | 3 | CSS lines 2-3; workspace page |
| `--pa-soft` `#edf3ef` / `#243b2d` | 16 | CSS lines 2-3; hover, selected, empty, table header |
| `--pa-brand` `#14573d` / `#9de1b9` | 13 | CSS lines 2-3; links, focus, active navigation |
| positive text/background `#176343/#e8f5ed` and `#a6e5be/#214432` | 4/4 | CSS lines 2-3, 13 |
| warning text/background `#785014/#fbf1da` and `#f5d295/#443620` | 6/5 | CSS lines 2-3, 9, 12-13 |
| negative text/background `#9d342e/#fff0ed` and `#ffb7ad/#472c29` | 4/4 | CSS lines 2-3, 10, 13 |
| `--pa-shadow` `0 2px 8px #183f2710` / `0 2px 8px #0002` | 6 | CSS lines 2-3; cards, tables, login |

| Property | Literal values and declaration counts | Evidence |
| --- | --- | --- |
| Font family | `Inter,system-ui,sans-serif` once; global has Inter and OS fallbacks | `platformAdmin.css:2`; `src/styles/global.css:1-8` |
| Font size | `12px×18`, `11px×12`, `10px×10`, `13px×6`, `9px×3`, `0×2`, `14/16/17/20px×2` each, and `8/15/18/19/24/27/28/30px×1` each | `platformAdmin.css:4-14,18` |
| Font weight | `650×7`, `600×4`, `550×3`, `700×2`, `500/750/800×1` each | `platformAdmin.css:4-13` |
| Line height | `1.2×2`, `1.4×2`, `1.3×1`, `1.55×1` | `platformAdmin.css:2,4,8,11,14` |
| Letter spacing | `-.02em×2`; `-.045/-.04/-.035/.04/.07/.08/.12em×1` each | `platformAdmin.css:4-5,9,11,13-14` |
| Gaps | `10px×8`, `12px×7`, `8px×7`, `16px×3`, `4px×3`, `5/6/9/18/20px×2`, `0/3/14/28px×1` | `platformAdmin.css:4-14,18` |
| Padding | `10px×8`, `16px×8`, `12px×4`, `8px×3`; one-off combinations include `9px 13px`, `18px 14px 12px`, `24px 30px 40px`, `16px 14px 28px` | `platformAdmin.css:4-14,18` |
| Margin | `0×10`, `4px×3`, `16px×3`, `20px×2`, `18px 0×2`, `12px 0×2`, `7px×2`, `10px 0×2`; other values are one-offs | `platformAdmin.css:4-14,18` |
| Radius | `8px×6`, `10px×5`, `11/6/7px×2`, `4/5/9/14/16px/50%×1` | `platformAdmin.css:4-14` |
| Border/shadow | `1px solid var(--pa-line)` appears 20 times; `var(--pa-shadow)` has four uses, alongside separate dialog, preview-menu and selected-nav shadows | `platformAdmin.css:4-14` |

There are 32 distinct literal hex colors in the scoped stylesheet. Most are paired light/dark token definitions; notable token bypasses are the primary button `#176b47/#105034`, scrim `#061c12aa`, and ad hoc shadow colors (`platformAdmin.css:4,9,14`). The main hierarchy uses page, surface, and soft levels; positive, warning and negative backgrounds add three semantic levels. There is no obvious card nested inside another bordered card on the overview screenshot; queue rows are separated within one panel. Evidence: `platformAdmin.css:2-3,11-14`; existing `dark-1440-overview.png`.

Contrast was calculated from the CSS sRGB hex colors with WCAG relative luminance. These are specified-color pairs, not a comprehensive browser pixel audit:

| Pair | Light | Dark | Finding |
| --- | ---: | ---: | --- |
| Main ink / surface | 13.96:1 | 12.23:1 | Pass 4.5 text |
| Muted text / surface | 5.48:1 | 6.97:1 | Pass 4.5 text |
| Brand link / surface | 8.54:1 | 9.86:1 | Pass 4.5 text |
| Positive badge text / background | 6.45:1 | 7.52:1 | Pass 4.5 text |
| Warning badge text / background | 6.32:1 | 8.10:1 | Pass 4.5 text |
| Negative badge text / background | 6.39:1 | 7.61:1 | Pass 4.5 text |
| Standard border / surface | **1.29:1** | **1.54:1** | Below 3:1 UI boundary target; medium/S to assess each control boundary |
| Soft surface / surface | **1.12:1** | **1.23:1** | Low separation when used without another cue; medium/S |

Inputs, buttons, tables and dialogs use those border/surface tokens (`platformAdmin.css:2-4,11-14`). Amber means pending review, unclassified, unknown, unavailable, not verified, or disabled; green means brand/selection as well as approved/succeeded/live/healthy/yes; red means rejected/failed/no (`PlatformAdminWorkspace.tsx:59-63`; `platformAdmin.css:11-13`). This overload makes green and amber semantic meaning context-dependent (medium/M). Theme is functional rather than half-built at the sampled routes: `PublicThemeToggle` sets the document attribute and dark tokens cover all scoped colors; 84 section/theme/width renderings showed no page overflow. Physical devices and full visual parity remain **UNVERIFIED** (`PublicThemeToggle.tsx:20-47`; `platformAdmin.css:2-3`; existing `light-1440-businesses.png`, `dark-1440-system-health.png`).

## 6. Copy inventory and vocabulary conflicts

The table records literal static user-facing copy. Each row includes the title and subtitle, then page-specific labels and actions; shared shell/filter/dialog copy follows. Verdicts are editorial proposals only. Page title/subtitle source: `PlatformAdminWorkspace.tsx:14-35`; column labels: `PlatformAdminPage.tsx:19-30`; page bodies: `PlatformAdminPage.tsx:199-236`.

| Page | Static strings by type | Verdict | Evidence |
| --- | --- | --- | --- |
| Overview | Title `Platform overview`; subtitle `Monitor businesses, subscriptions, payments, and platform health.`; KPIs `Total businesses`, `Active businesses`, `Applications awaiting review`, `Contracts expiring soon`, `Payments awaiting review`, `Active trials`; queue `Needs your attention`, `Applications need a decision`, `Payment evidence needs review`, `Upcoming contract renewals`; activity `Recent platform activity`, `View audit logs`; summary `Contracts & business continuity`, `Active annual contracts`, `Expired contracts`, `Review contracts`. | Keep titles; reword repeated count context (medium/S). | `PlatformAdminWorkspace.tsx:20-21,65-93` |
| Applications | `Applications`; `Review new business applications and keep each decision traceable.`; columns `Business`, `Type`, `Decision`, `Submitted`; actions `View details`, `Approve`, `Reject`; policy note begins `Application intake is disabled...`. | Keep actions; dev-note/policy deserves secondary placement (low/S). | `PlatformAdminWorkspace.tsx:15,22`; `PlatformAdminPage.tsx:21,32,202,217` |
| Businesses | `Businesses`; `Your hospitality business directory, with ownership and reviewed classification.`; columns `Business`, `Classification`, `Owner association`, `Entitlement`, `Created`; `View details`, `Review classification`; policy begins `Classification is a reviewed label...`. | Reword dense labels; retain truth warning; decide entitlement visibility (medium/M). | `PlatformAdminWorkspace.tsx:15,23`; `PlatformAdminPage.tsx:20,33,217` |
| Users & Access | `Users & Access`; `Understand who belongs to each business and review invitation records.`; `Business members`, `Invitations`; columns `Member`, `Business`, `Tenant role`, `Active`, `Created` or `Application`, `Delivery`; policy begins `Tenant membership and platform administrator authorization...`. | Keep distinction; reword `Tenant role` if founder vocabulary differs (low/S). | `PlatformAdminWorkspace.tsx:15,24`; `PlatformAdminPage.tsx:22-23,34,205` |
| Contracts & Trials | `Contracts & Trials`; `Review subscription terms, trial dates, and upcoming renewal work.`; columns `Business`, `Term`, `Start`, `End`, `Term timing`; helper `Term timing is calculated from recorded dates...`; timing `Unavailable`, `Upcoming term`, `Term ended`, `Ends within 30 days`, `Within term`; policy begins `Trials require a separate readiness authority...`. | Keep timing caveat; vocabulary decision needed (medium/S). | `PlatformAdminWorkspace.tsx:6-12,16,25`; `PlatformAdminPage.tsx:24,35,212` |
| Payments & Renewals | `Payments & Renewals`; `Review submitted subscription payments. Evidence is not confirmation.`; columns `Business`, `Amount`, `Currency`, `Channel`, `Payment date`, `Review`; action `Record submitted payment`, `Reject payment`; policy begins `ServeFlow subscription reviews...`. | Keep evidence caveat; distinguish submitted/rejected from confirmed (high/S). | `PlatformAdminWorkspace.tsx:16,26`; `PlatformAdminPage.tsx:25,36,213,217` |
| Notifications | `Notifications`; `Track contract reminders and the evidence of their delivery.`; columns `Contract`, `Days before expiry`, `Due`, `Delivery`; policy begins `30-day and 15-day reminder identities...`. | Keep delivery caveat; reword technical note (low/S). | `PlatformAdminWorkspace.tsx:16,27`; `PlatformAdminPage.tsx:26,37` |
| System Health | `System Health`; `See what has been checked and where service visibility is still missing.`; `Observed service checks`; `Database`, `Web application`, `Sign-in service`, `File storage`, `Live updates`, `Background services`; `Unknown means no supported live probe...`. | Keep probe caveat; sentence-case labels later (low/S). | `PlatformAdminWorkspace.tsx:16,28`; `PlatformAdminPage.tsx:220` |
| Errors & Diagnostics | `Errors & Diagnostics`; `Investigate reported administration issues without exposing private error details.`; columns `Time`, `Redacted category`, `Source`, `Correlation`; policy begins `Only newly collected, redacted...`. | Keep privacy warning; explain `Correlation` in detail panel (medium/S). | `PlatformAdminWorkspace.tsx:17,29`; `PlatformAdminPage.tsx:29,38,226` |
| Integrations | `Integrations`; `Review service connections and their verification status.`; `Integration evidence`; `Supabase Auth`, `Storage`, `Realtime`, `OpenAI menu imports`, `Invitation and reminder delivery`, `Printer integration`; `Not verified`, `Not configured`, `Paused`. | Keep honest states; decide which dev/service names belong in founder UI (medium/S). | `PlatformAdminWorkspace.tsx:17,30`; `PlatformAdminPage.tsx:221` |
| Backups & Recovery | `Backups & Recovery`; `Understand backup evidence before planning any recovery operation.`; `Recovery readiness`; `Backup configured`, `Last successful backup`, `Restoration tested`, `Verified restorable`; `Unknown — no verified backup evidence available`; runbook paragraph. | Keep unknown evidence; dev-note placement decision (medium/S). | `PlatformAdminWorkspace.tsx:17,31`; `PlatformAdminPage.tsx:222` |
| Audit Logs | `Audit Logs`; `Trace platform decisions by actor, target, date, and outcome.`; columns `Time`, `Actor`, `Action`, `Target`, `Outcome`, `Reason`, `Request`; filters `Action, actor, target or request ID`, `From date (UTC)`, `Through date (UTC)`. | Keep trace fields; decision on technical IDs in primary table (medium/M). | `PlatformAdminWorkspace.tsx:17,32`; `PlatformAdminPage.tsx:27,207-210` |
| Administrators & Access | `Administrators & Access`; `Review privately authorized platform identities and their access scope.`; columns `Administrator`, `Auth identity`, `Active`, `Manage`, `Sensitive`, `Recovery reviewed`; policy begins `Named identities are provisioned privately...`. | Keep access semantics; move raw identity to details (medium/S). | `PlatformAdminWorkspace.tsx:18,33`; `PlatformAdminPage.tsx:28,39,226` |
| Security & Recovery | `Security & Recovery`; `Review the safeguards protecting your platform and recovery process.`; `Enforced administrator boundary`, `Unavailable capabilities`, with authorization and disabled-actions paragraphs. | Keep security truth; shorten first-screen copy after terminology approval (medium/M). | `PlatformAdminWorkspace.tsx:18,34`; `PlatformAdminPage.tsx:223` |

Shared visible copy includes nav `Overview`, `Applications`, `Businesses`, `Subscriptions & Payments`, `Users & Access`, `Notifications`, `System & Security`; section tabs; `ServeFlow Platform`, `Platform workspace`, `ServeFlow administration`, `Visual preview`, `No administrative access`, `Collapse sidebar`, `Refresh`, `Available actions & policy`, `Search`, `Search records`, `Status`, `All`, `First page`, `Next page`, `Details`, `Action`, `Reviewed`, `Try again`, `No records match this query...`, `Loading authorized platform information...`, `Source`, `Checked`, `Technical references`, `Close record details`, `Cancel`, `Decision reason`, and confirmation text. Preview-only copy includes `LOCAL PREVIEW · SYNTHETIC DATA`, `Preview controls`, `Display state`, `Populated`, `Loading`, `Empty`, `Error`, `Exit preview`, and explicit no-save warnings. Evidence: `PlatformAdminWorkspace.tsx:40-56`; `PlatformAdminPage.tsx:185-236`. Private entry copy includes `Administrator sign in`, `Verify your authenticator`, `Recovery review required`, `Administrator email`, `Password`, `Authenticator code`, `Sign in`, `Verify MFA`, `Sign out`, and `Return to ServeFlow` (`PlatformAdminPage.tsx:158-174`).

The remaining literal supporting copy is grouped below so editorial review does not lose policy meaning. These are still copy proposals; they do not authorize changing the stated rule.

| Page/context | Additional exact static copy (type) | Verdict / evidence |
| --- | --- | --- |
| Overview KPI hints | `Your complete business directory`; `Verified operational access`; `New businesses requesting access`; `Renewals due within 30 days`; `Submitted evidence to review`; `Businesses in their trial period`; fallback `Verified data not available`. | Keep only where the paired metric is supported; `Workspace.tsx:67-82`. |
| Overview queue/activity/summary | `Your work queue`; `Review business details before approving or rejecting.`; `Check submitted evidence; no payment is confirmed automatically.`; `Review terms and plan the next conversation.`; `No outstanding items in this queue.`; `This queue is not yet available.`; `Platform health & security`; `Open service checks · overall status not verified`; `A clear record`; `Activity summary unavailable`; `Open Audit Logs to review the available platform records.`; `Subscription portfolio`; `Review terms before renewal. Expiry never means deleting business history.` | Keep truthful caveats; trim repeated explanations later; `Workspace.tsx:75-93`. |
| Applications policy | `Application intake is disabled pending approved applicant retention. Approval records a delivery-disabled invitation intent; it does not create an account, send email or activate a trial.` | Keep rule; reconsider primary placement; `Page.tsx:32`. |
| Businesses policy | `Classification is a reviewed label, not a paid entitlement. Existing businesses remain unclassified until reviewed. Suspension and restoration are unavailable until server enforcement is complete.` | Keep rule; reconsider primary placement; `Page.tsx:33`. |
| Users policy | `Tenant membership and platform administrator authorization are separate. Invitations cannot be sent, accepted or provisioned until the reviewed provider and provisioning workflow are enabled.` | Keep rule; `Page.tsx:34`. |
| Contracts policy/helper | `Trials require a separate readiness authority. Annual terms are exactly 365 × 24 hours. Activation, renewals and expiry enforcement cutover are unavailable; existing dates and access are unchanged.`; `Term timing is calculated from recorded dates. It does not confirm payment, renewal, or operational access.` | Keep truth; founder terminology decision; `Page.tsx:35,212`. |
| Payments policy | `ServeFlow subscription reviews are separate from restaurant customer invoices. A recorded payment is unverified evidence. Approval and contract activation are disabled pending enforcement and renewal policy. No evidence upload is enabled.` | Keep truth; `Page.tsx:36`. |
| Notifications policy | `30-day and 15-day reminder identities have a durable outbox foundation. Scheduling and delivery are disabled until channel, recipients and send policy are approved.` | Dev-note candidate; keep disabled-delivery meaning; `Page.tsx:37`. |
| Diagnostics policy | `Only newly collected, redacted administrator-interface failures appear here. Historical Edge logs and tenant errors are not ingested. No automatic repair is enabled.` | Keep scope; `Page.tsx:38`. |
| Administrators policy | `Named identities are provisioned privately. No administrator creation, promotion, revocation or recovery endpoint is exposed here. Recovery review is an operator attestation, not a completed recovery drill.` | Keep rule; `Page.tsx:39`. |
| System Health | `Observed service checks`; `Unknown means no supported live probe was performed. This view does not check or resume printing.` | Keep; `Page.tsx:220`. |
| Integrations | `Integration evidence`; `Not verified — no integration health probe configured`; `Invitation and reminder delivery`; `Not configured`; `Printer integration`; `Paused — excluded from checks and recovery`. | Keep state distinction, decide product-facing names; `Page.tsx:221`. |
| Backups | `Recovery readiness`; `Unknown — no verified backup evidence available`; `Restoration requires a separately approved runbook, verified target, pre-restoration safeguard, out-of-band authorization and post-restore validation. No restore or shell action is exposed.` | Keep truth, reword later; `Page.tsx:222`. |
| Security | `Enforced administrator boundary`; `Administrator authorization is checked in the database for every platform operation. Verified recovery must be recorded through the trusted provisioning procedure. User metadata and tenant roles do not grant access.`; `Unavailable capabilities`; `New application intake, invitation delivery/acceptance, provisioning, trial activation, contract activation/renewal, suspension/restoration, notification sending and recovery mutations are disabled. No dashboard switch enables them.` | Keep boundaries; `Page.tsx:223`. |
| Review/detail dialog | `Record details`; `Synthetic record for visual review only.`; `Confirm`; `Synthetic preview only. This form will not save a decision or contact a platform service.`; `Reviewed classification`; `Business UUID`; `Currency code`; `Payment channel`; `Payment date and time`; `Transaction reference`; `Do not enter passwords, tokens, payment credentials or unnecessary personal information.`; `I reviewed the synthetic target. No decision will be saved.`; `I reviewed the target and understand this decision will be audited.`; `Approval does not send an invitation, provision an account or activate a trial.`; `Preview decision — no changes`; `Confirm decision`. | Keep explicit consequence/no-save wording; `Page.tsx:226-236`. |
| Private entry/errors | `ServeFlow · Private administration`; `Verifying access`; `Access is restricted to privately provisioned platform administrators. Restaurant accounts do not grant platform access.`; `Checking administrator session…`; `Privileged access is disabled until your verified recovery procedure is reviewed by the trusted operator. This page cannot provision or recover administrators.`; `Administrator authorization could not be verified. No platform data was loaded.`; `Administrator session unavailable.`; `No verified TOTP factor is available. Follow the founder-controlled enrollment/recovery procedure.`; `MFA verification failed. Check your authenticator and try again.`; `Sign-in failed. Check your credentials or use the verified recovery procedure.`; `This account is not an authorized platform administrator, or the platform service is not configured.`; `Authentication service unavailable. Access was not granted.`; `Sign-out could not be confirmed. Close this administrator tab and follow the session-revocation procedure if necessary.` | Preserve truthful failure states; `Page.tsx:78-79,109-135,158-174`. |
| Mutation feedback and generic error | `Preview only — the synthetic decision was not saved and no platform service was contacted.`; `Application approved. Invitation delivery is not configured; no email or account was created.`; `Change recorded with its server audit event.`; safe client messages for access denied, conflict, invalid values, missing record and service unavailable. | Keep accurate results; `Page.tsx:142-154`; `platformAdminService.ts:25-31`. |

| Vocabulary conflict | Where terms occur | Decision needed |
| --- | --- | --- |
| Active / Live / verified operational access | `Active businesses` vs `live` classification vs `Verified operational access`; `Workspace.tsx:68-70`; `Page.tsx:20,208` | Do not equate these data concepts. |
| Status / Decision / Review / Classification / Entitlement | Filter and columns use all five; `Page.tsx:20-28,208`; policy `Page.tsx:33-36` | Founder terminology and field visibility. |
| Business / restaurant / tenant / owner / account | UI says business/owner; client and RPC fields say restaurant/tenant; `Page.tsx:20-23,231`; `platformAdminService.ts:27-47` | Editorial choice only. |
| Trial / annual term / contract / renewal / subscription | Main nav vs tabs vs policy vs timing; `Workspace.tsx:16,42,53-56`; `Page.tsx:24,35-36` | Separate state names before copy revision. |
| Error / diagnostic / failure / service health | Page title, redacted category, and health panel; `Workspace.tsx:16-17,28-29`; `Page.tsx:29,38,220` | Severity vocabulary. |

Dates use `new Date(value).toLocaleString()` with no locale or timezone argument, including seconds on the inspected browser; preview activity does the same. `contractTiming` parses dates with `Date.parse` relative to `asOf`; audit date filters are explicit UTC day bounds. Metrics use `Number.toLocaleString()`. No hard-coded locale was found in these helpers; browser locale/timezone therefore affects display. Evidence: `PlatformAdminPage.tsx:18,210`; `PlatformAdminWorkspace.tsx:6-12,89`; `platformAdminService.ts:24,42-47`; existing `light-1440-businesses.png`.

## 7. Page-by-page findings

The following top positions are live Chromium measurements of the first table/panel/card at 1440×900 and 390×844, not screenshots or a claim that all content is visible. Shared shell states are loading, error with retry, and list empty. The preview selector forces those states; panels with no list use explicit unavailable/unknown copy instead. Evidence: `PlatformAdminPage.tsx:87-107,198-224`; `platformAdmin.css:11-18`.

| Page | Purpose / first content top desktop → phone | Primary action; noise/defect | Severity / effort | Evidence |
| --- | --- | --- | --- | --- |
| Overview | Platform summary; KPI grid 264 → 254px | Queue links are useful, but queue is below six mobile KPIs and repeats counts. Activity is fixture-only in preview. | High / M | `Workspace.tsx:65-93`; existing `light-320-overview.png` |
| Applications | Review decisions; table 439 → 554px | Pending Approve/Reject and details share visual weight; policy and filter push records down. | Medium / S | `Page.tsx:21,32,202-218`; existing `light-1440-applications.png` |
| Businesses | Directory/classification; table 439 → 554px | Entitlement repeats unavailable copy in preview; at 768/1024px the table splits headers and data mid-word. | High / M | `Page.tsx:20,33,217`; `276_platform_admin_foundation.sql:213-224`; existing `light-768-businesses.png`, `light-1024-businesses.png` |
| Users & Access | Membership/invitations; table 558 → 540px | Two tabs plus policy/filter delay records; platform admins are a separate route. | Low / S | `Page.tsx:22-23,34,205-218`; `Workspace.tsx:53-56` |
| Contracts & Trials | Term review; table 536 → 537px | Derived timing may be mistaken for entitlement unless caveat remains. | Medium / S | `Workspace.tsx:6-12`; `Page.tsx:24,35,212` |
| Payments & Renewals | Evidence review; table 562 → 677px | `Record submitted payment` plus policy/filter/tabs leave little first-screen record space. Payment remains pending evidence. | Medium / M | `Page.tsx:25,36,200-218`; existing `light-320-payments.png` |
| Notifications | Reminder evidence; table 439 → 402px | Delivery-disabled state needs to remain explicit; no send action. | Low / S | `Page.tsx:26,37,217`; `Preview.tsx:19` |
| System Health | Observed checks; panel 327 → 405px | Several unknown states; avoid reading a healthy database query as whole-platform health. | Medium / S | `Page.tsx:220`; `276_platform_admin_foundation.sql:282-285` |
| Errors & Diagnostics | Redacted failures; table 502 → 572px | Correlation ID and environment belong in secondary detail; no repair action. | Low / S | `Page.tsx:29,38,180,226` |
| Integrations | Connection evidence; panel 327 → 387px | Service names may be developer-facing; all unsupported checks say not verified. | Medium / S | `Page.tsx:221`; `Workspace.tsx:30` |
| Backups & Recovery | Recovery evidence; panel 327 → 405px | Four repeated unknown values and long runbook copy, but no restore control. | Medium / S | `Page.tsx:222`; `Workspace.tsx:31` |
| Audit Logs | Trace decisions; table 448 → 808px | Date filters consume much of 390×844 first screen; IDs are secondary in details. | Medium / M | `Page.tsx:27,207-210,217,226` |
| Administrators & Access | Private identity review; table 502 → 572px | Access flags need plain-language interpretation; provisioning remains absent. | Medium / S | `Page.tsx:28,39,217` |
| Security & Recovery | Guardrails; panel 327 → 405px | Dense policy prose is honest but not a service readiness assessment. | Low / M | `Page.tsx:223`; `Workspace.tsx:34` |

All list routes can show an empty message, loading skeleton, and error/retry. Overview uses `Unavailable` for absent metrics and an activity-empty panel outside preview. For Integrations/Backups/Security, a preview “empty” state has no list; these panels still show static capability explanations while data-dependent security text becomes unavailable. That distinction should remain visible during Phase 2. Evidence: `PlatformAdminPage.tsx:89-105,203-224`; `PlatformAdminWorkspace.tsx:82-93`.

## 8. Responsive findings

CSS switches the overview grid at 1100px, the sidebar to a drawer at 1000px, and tables to stacked records at 600px; 1600px only changes content padding. At 601–1000px, tables retain a minimum 680px width inside a horizontally scrollable region, so the *table region* can scroll even when the page does not. Mobile uses stacked records below 600px. Evidence: `platformAdmin.css:13,15-18`.

The 768px and 1024px Business screenshots reveal a separate readability defect: the seven-column table compresses to roughly the available width and `overflow-wrap:anywhere` breaks headers and values inside words. This occurs even without document-level overflow. Severity high, effort M. Evidence: `platformAdmin.css:2,13,17-18`; existing `light-768-businesses.png`, `light-1024-businesses.png`.

| Width | Live read-only check | Screenshot evidence |
| --- | --- | --- |
| 320, 360, 390, 768, 1024, 1280, 1536, 1920 | Overview, Businesses and Payments returned document/body scroll width equal to viewport width; no page-level horizontal overflow. Other 11 sections were also measured at 390 and 768 in both themes without document overflow. | Existing screenshots cover 320 and 768 for seven representative sections; no new screenshots were written. Source: `platformAdmin.css:13,15-18`. |
| 1440 | All 14 sections measured in both themes without document overflow. | Existing `light-1440-businesses.png`, `light-1440-applications.png`, `dark-1440-system-health.png`; source `platformAdmin.css:5-18`. |

**Screenshot matrix limitation:** the user requested new images for every page at 1440/768/390 in both themes, but the hard rule permits creating only this report. Existing `test-results/admin-redesign-resume/` screenshots cover seven sections at 1440/768/320/375/1024 in both themes, not all 14 at 390. That full screenshot request is **UNVERIFIED**; it was not silently substituted with source inspection. Visual inspection of existing 320px overview/Payments and 1440px Applications/Businesses/System Health screenshots found no blocking overlap; physical devices remain **UNVERIFIED**.

At 390px the header is 62px and has brand, theme toggle, Exit preview and menu; at desktop it is 68px. The content has `max-width:1600px` and `margin-left:244px`, so 1920px can leave unused right-side area. `index.html` sets `width=device-width, initial-scale=1.0`; no admin `env(safe-area-inset-*)` rule was found. Text sizes use fixed px; browser text scaling/200% zoom and notched-device safe areas are **UNVERIFIED**. Evidence: `platformAdmin.css:5-8,15-18`; `index.html:3-5`; existing `light-320-overview.png`.

## 9. Accessibility findings

| Finding | Severity / effort | Evidence |
| --- | --- | --- |
| Header, nav and main landmarks, a skip link, section headings, and named icon-only menu/collapse/detail buttons exist. No unlabeled icon-only button was found in the audited shell. | Positive / — | `PlatformAdminPage.tsx:185-200,217,226`; `Workspace.tsx:44-56,82`; `PublicThemeToggle.tsx:39-46` |
| `:focus-visible` covers links, buttons, inputs, selects, textareas, summary and tabindex elements. | Positive / — | `platformAdmin.css:4` |
| Drawer, details and action dialogs use `useModalFocus`; it traps Tab, closes with Escape and restores previous focus. Body scrolling is locked while open. Browser regression tests cover representative drawer/dialog behavior, but screen-reader use is **UNVERIFIED**. | Positive / — | `useModalFocus.ts:28-79`; `PlatformAdminPage.tsx:61-64,189-191,226-238`; `tests/e2e/platform-admin-preview.spec.ts:75-92` |
| Below-44px controls listed in executive summary reduce touch comfort; table action buttons meet 44px default. | Medium / S | `platformAdmin.css:4,7,9-11,18`; `Workspace.tsx:82` |
| Status badges include text, so status is not color-only. Yet `No` uses negative tone even for a false access flag, which may suggest an incident. | Medium / S | `Workspace.tsx:59-63`; `Page.tsx:217` |
| Source has reduced-motion override for animation/transition/scroll. | Positive / — | `platformAdmin.css:14,19` |
| Forms have visible wrapping labels and native required/minLength checks, but server errors appear at form/page level rather than bound to individual fields with `aria-describedby`. | Medium / M | `PlatformAdminPage.tsx:203,229-236`; `platformAdmin.css:4` |
| Border/surface color ratio is below 3:1; actual focus outline uses stronger brand color. Evaluate boundary reliance per control in Phase 2. | Medium / M | `platformAdmin.css:2-4`; token audit above |

## 10. Destructive actions and embedded business rules: do not break

Only four consequential mutation classes are exposed: business classification, application approve/reject, record submitted payment, and reject payment. Each opens a dialog with a required 3–500 character reason and checkbox confirmation; the client sends `reason` and request ID. The checked-in SQL signatures and constraints accept/restrict reasons, but whether those migrations are applied to a target is **UNVERIFIED**. Preview submission exits locally before RPC. No visible suspend, restore, role-change, remove, contract-activation, payment-approval or notification-send control was found. Evidence: `PlatformAdminPage.tsx:16,138-155,217,227-236`; `platformAdminService.ts:49-55`; `supabase/migrations/276_platform_admin_foundation.sql:299-373`.

| Rule expressed in UI | Source enforcement evidence / limit |
| --- | --- |
| Classification does not confer paid entitlement; suspension/restoration are unavailable. | `PlatformAdminPage.tsx:33`; checked-in read RPC emits unresolved entitlement `276_platform_admin_foundation.sql:213-219`. Target application **UNVERIFIED**. |
| Approval records an invitation intent; it does not send email, create account or activate trial. | `PlatformAdminPage.tsx:32,151,234`; decision SQL audits delivery as `not_configured` at `276_platform_admin_foundation.sql:322-336`. |
| Recorded subscription payment is unverified evidence; contract activation/payment approval stay disabled. | `PlatformAdminPage.tsx:36,150-151`; SQL record/reject flows `276_platform_admin_foundation.sql:340-373`. |
| Contract timing does not prove payment, renewal or access; expiry does not delete history. | `PlatformAdminPage.tsx:35,212`; `PlatformAdminWorkspace.tsx:6-12,93`. This audit did not verify entitlement enforcement. |
| Notifications' 30/15-day identities exist, but scheduling/delivery are disabled. | `PlatformAdminPage.tsx:37`; source RPC reads outbox `276_platform_admin_foundation.sql:258-262`. |
| Backups, recovery, integrations and service checks remain unknown/unverified where no probe exists. | `PlatformAdminPage.tsx:220-223`; `276_platform_admin_foundation.sql:282-289`. |
| Named admin identity, recovery review, MFA and server authorization must remain separate from tenant membership. | `PlatformAdminPage.tsx:34,39,66-84,109-129,223`; `platformAdminService.ts:28-40`; `276_platform_admin_foundation.sql:182-203`. |

## 11. Confirmed / refuted known problems

| Screenshot-based claim | Verdict with evidence | Severity / effort |
| --- | --- | --- |
| Header about 95px; sidebar items about 70px apart; sidebar scrollbar; duplicate identity | **Partly refuted.** Header is 68px desktop/62px phone, main nav links have 44px minimum plus 3px gap. Expanded operations sidebar did scroll at 1440×900; brand and workspace identity repeat. `platformAdmin.css:5-7,18`; `Page.tsx:186,192`; existing `light-1440-businesses.png`. | Medium / M |
| `WORKSPACE` in group and page eyebrow | **Confirmed** on main pages. `Workspace.tsx:45`; `Page.tsx:199`; existing `light-1440-businesses.png`. | Low / S |
| Preview scaffolding in about six places | **Confirmed as distributed**, though some fixture strings are inside records rather than six separate banners. `Preview.tsx:4-22`; `Page.tsx:186-198,224,226-236`. | Medium / M |
| Counts repeated in KPIs and attention | **Confirmed** for pending applications, payments and expiring contracts. `Workspace.tsx:67-85`; existing `light-320-overview.png`. | Medium / S |
| Approve, Reject and View details equally prominent | **Partly confirmed.** Three same-style buttons appear for pending rows; their widths differ and reviewed rows show no decision button. `Page.tsx:217`; existing `light-1440-applications.png`. | Medium / S |
| Classification wraps mid-word; every preview entitlement unavailable; 7 records paginate | **Confirmed at 768 and 1024; refuted at 1440.** `light-768-businesses.png` and `light-1024-businesses.png` show mid-word breaks; `light-1440-businesses.png` does not. Entitlement repetition and 7-row/4-row pagination are confirmed by `Preview.tsx:12-13,26-41,57-60` and `Page.tsx:217-218`. | High / M |
| Mixed casing, tracked uppercase labels, timestamps with seconds | **Confirmed.** `platformAdmin.css:4,13`; `Page.tsx:18`; existing `light-1440-businesses.png`. | Low / S |
| Mobile four header items, tiny text, queue below six cards | **Confirmed at 320px;** 390px browser geometry supports same order. `Page.tsx:186-199`; `Workspace.tsx:67-87`; `platformAdmin.css:18`; existing `light-320-overview.png`. | High / M |

## 12. Risks and unknowns

- **UNVERIFIED:** full 14-page × 3-width × 2-theme screenshot set. The source hard rule permits only this report to be created; existing screenshots cover a subset. No new screenshots were written. Evidence: existing `test-results/admin-redesign-resume/` screenshot names and `tests/e2e/platform-admin-preview.spec.ts:94-118`.
- **UNVERIFIED:** hosted behavior, applied migration level, real administrator context, production service health, physical phones, Safari/WebKit, safe-area layout, text zoom and screen-reader behavior. Source and Chromium preview are insufficient for those claims (`PlatformAdminPage.tsx:66-107`; `index.html:5`; `platformAdmin.css:15-19`).
- Current `npx tsc --noEmit -p tsconfig.json --incremental false` passed. Current focused Vitest run passed 23/23 tests in two files. No lint script is defined, so lint is **UNVERIFIED**. A new build was not run because it would write generated files outside the one-file audit allowance; production bundle status for this exact audit is **UNVERIFIED**. Evidence: `tsconfig.json:1-22`; `package.json:6-19`; `tests/unit/platform-admin-preview.test.ts:1-47`; `tests/unit/platform-admin.test.ts:1-69`.
- Existing Playwright tests cover all 14 routes, navigation, local-only mutation, overflow, theme/contrast, and private-path regression; the visual matrix captures seven routes at five widths, not 14 routes at 390px. This audit's no-file browser pass rendered 84 section/theme/width combinations and found no document overflow. Evidence: `tests/e2e/platform-admin-preview.spec.ts:1-176`; `tests/e2e/platform-admin.spec.ts:1-180`; `platformAdmin.css:15-18`.
- Git started dirty with Super Admin source/tests, a generated TypeScript build-info file, earlier reports and screenshots. During the audit, HEAD advanced externally to `019553f`; this audit did not commit or alter those files. The final status check below is the file-safety authority. Evidence: `docs/SUPER_ADMIN_COMPLETE_UI_REDESIGN_REPORT.md:1-66`; source paths cited above.

## 13. PROPOSAL

This is a frontend proposal for a later phase, not implementation authorization. It does not propose changes to API calls, data models, auth, permissions, routing, or server enforcement.

### A. Minimal token set

| Current | Proposed presentation token | Rationale / effort | Evidence |
| --- | --- | --- | --- |
| Page `--pa-bg`, panel `--pa-surface`, hover `--pa-soft` | Keep three surfaces: page, raised, subtle | Preserve existing hierarchy, remove one-off nested effects. S | `platformAdmin.css:2-3,11-13` |
| `--pa-line` at 1.29/1.54 contrast | One stronger neutral border token | Evaluate controls and focus separately; do not alter status meaning. M | `platformAdmin.css:2-4,11-14` |
| `--pa-brand`, positive/warning/negative pairs | Keep brand plus three semantic pairs | Distinguish brand from success and unknown from pending in copy. M | `platformAdmin.css:2-3,11-13`; `Workspace.tsx:59-63` |
| 8–30px sizes, many 9–11px labels | Type scale: 12, 14, 16, 20, 28px, with 12px floor for ordinary text | Fewer levels and better mobile legibility. M | `platformAdmin.css:4-13,18` |
| 0–28px gaps, many one-off padding values | Spacing steps: 4, 8, 12, 16, 24, 32px | Map existing 10/14/18/20px to nearest tested step per component. M | `platformAdmin.css:4-14` |
| Radius 4–16px and 50% | 6px control, 10px card/dialog, circle avatar only | Preserve recognizable softness with fewer values. S | `platformAdmin.css:4-14` |

### B. Component inventory decision

| Action later | Components | Effort / risk | Evidence |
| --- | --- | --- | --- |
| Consolidate | Table/filter/pagination, list empty/error/loading, details/action dialog spacing | M; action buttons must retain the existing reason/confirmation flow. | `PlatformAdminPage.tsx:203-238` |
| Build within existing shell | A single compact status/context strip and a reusable record-action hierarchy; no second dashboard | M; preview truth and private controls must stay distinct. | `PlatformAdminPage.tsx:186-198,217`; `Workspace.tsx:65-93` |
| Leave | `useModalFocus`, `PublicThemeToggle`, route guard, service/client contracts | S review only; changing these would cross this phase boundary. | `useModalFocus.ts:16-79`; `PublicThemeToggle.tsx:20-47`; `AppRouter.tsx:26-43` |

### C. Recommended work order

1. **S:** Agree vocabulary and which development notes belong in the founder UI. Risk: copy could imply unverified entitlement or delivery (`Page.tsx:31-39`; `Workspace.tsx:20-35`).
2. **M:** Consolidate type/spacing/border tokens, then remeasure text, borders and 44px targets in both themes. Risk: shared CSS affects all 14 sections (`platformAdmin.css:2-19`).
3. **M:** Tighten overview hierarchy and mobile first screen using the existing data contract. Risk: missing production metrics must remain unavailable (`Workspace.tsx:65-93`; `276_platform_admin_foundation.sql:204-212`).
4. **M:** Simplify record tables/actions and preview notices in the existing shell. Risk: decision dialogs and preview no-op must remain unmistakable (`Page.tsx:142-155,186-238`).
5. **M:** Recheck all routes and widths with new visual evidence when screenshot creation is authorized. Risk: the current screenshot set is incomplete (`tests/e2e/platform-admin-preview.spec.ts:94-118`).

### D. Decisions needed before Phase 2

1. Which founder-facing terms distinguish **active**, **live classification**, **paid entitlement**, **trial**, and **annual contract**? Source: `Workspace.tsx:68-78`; `Page.tsx:20,24,33-36`.
2. Which policy and developer notes should stay in the primary UI, move to secondary help, or appear only in local preview? Source: `Page.tsx:31-39,198,220-223`.
3. The current API and UI require a stored reason for Reject. Should the redesigned interaction keep that visible requirement and what wording should explain it? This is an editorial question, not a proposal to change the API. Source: `Page.tsx:143,148-149,232-236`; `276_platform_admin_foundation.sql:322-373`.
4. Is mobile a primary operating surface or occasional review access? The answer affects first-screen order and density, while preserving the same actions. Source: `platformAdmin.css:18`; existing `light-320-overview.png`.
5. Should `Entitlement` remain in the directory with an honest unresolved state, or move to details after the terminology is agreed? Do not delete its meaning from the UI without a founder decision. Source: `Page.tsx:20,33,217`; `276_platform_admin_foundation.sql:213-219`.

**Stop point:** Phase 1 evidence and proposal only. Phase 2 is pending an explicit “go.”
