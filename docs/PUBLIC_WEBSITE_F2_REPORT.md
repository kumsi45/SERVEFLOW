# ServeFlow public website F2 implementation report

Date: 2026-10-16. Scope: shared public footer, draft legal pages, public metadata and local verification. No deployment authorized or performed.

## Implementation

The shared footer appears on `/`, `/about`, `/pricing`, `/contact`, `/privacy`, `/terms`, `/cookies`, and `/acceptable-use`.

| Group | Destinations |
| --- | --- |
| Product | Features `/#platform`; Industries `/#industries`; Pricing `/pricing`; Request a trial `/contact` |
| Company & Support | About ServeFlow `/about`; Contact `/contact`; Contact support uses the existing encoded WhatsApp destination at `https://wa.me/251990069892` |
| Legal | `/privacy`, `/terms`, `/cookies`, `/acceptable-use` |
| Utility | Current-year ServeFlow copyright; duplicate footer logo/home and Sign in links removed in the founder-requested spacing adjustment |

The footer uses the existing green/cream palette, the approved tagline, stacked mobile groups, visible focus and minimum 44 CSS pixel link heights. Public-only hash handling corrects cross-page anchor scrolling after React renders, with sticky-header clearance.

All four legal routes have shared navigation/footer, page-specific metadata, contents links, and a visible draft/legal-review notice. About and Contact metadata use ServeFlow. Verified founder details remain; the unverified characterization of KumsiTech as a technology company was removed. Existing pricing, reviewed-trial wording, header destinations and non-footer calls to action remain unchanged. No fake email, numeric price, legal entity, canonical domain or compliance claim was added.

## Exact source and test files

| File | Purpose |
| --- | --- |
| `src/app/router/AppRouter.tsx` | Four legal routes, including trailing slash forms |
| `src/modules/landing/components/PublicSiteChrome.tsx` | Shared footer |
| `src/modules/landing/components/PublicPageLayout.tsx` | Shared public layout and skip link |
| `src/modules/landing/hooks/usePublicMetadata.ts` | Title, description and Open Graph text |
| `src/modules/landing/hooks/usePublicHashScroll.ts` | Public anchor scrolling after render |
| `src/modules/landing/pages/LandingPage.tsx` | Replace duplicate footer and reuse public hooks |
| `src/modules/landing/pages/PublicPages.tsx` | Shared layout, founder wording and About/Contact metadata |
| `src/modules/landing/pages/PublicLegalPages.tsx` | Four product-specific draft legal documents |
| `src/modules/landing/publicContact.ts` | Reuse existing WhatsApp destination and encoding |
| `src/modules/landing/styles/landing.css` | Scoped footer/legal styles and anchor clearance |
| `tests/e2e/public-footer-legal.spec.ts` | 24 browser cases across two Chromium projects |
| `tests/e2e/public-workflows.spec.ts` | Affected metadata/founder expectations and main-content trial-link scope |
| `tests/unit/public-legal-pages.test.tsx` | Six render/content/contact checks |
| `docs/PUBLIC_WEBSITE_F2_REPORT.md` | This report |

## Verification

- `npm run build`: PASS; TypeScript and Vite completed, 2,353 modules transformed. Vite emitted a plugin-timing advisory.
- Vitest: PASS, one file / six tests. Run twice during implementation; both runs passed six tests.
- Browser coverage: all 54 selected cases have passing results across the last full run and focused rerun. The last full run was 52 passed / two failed because the destination test incorrectly required a `main` landmark on the existing sign-in screen. That assertion now checks its actual `Welcome back` heading; the focused rerun passed both desktop/mobile cases (36.2 seconds). No sign-in code was modified.
- Earlier exploratory browser runs: 45 passed / three failed, then 50 passed / four failed. These failures led to the fixes and test corrections described below; they are not omitted from the verification history.
- `git diff --check`: PASS. Line-ending advisories are informational; no whitespace errors were reported.
- No remaining defect found within the implemented F2 scope. Legal finalization and production verification remain outstanding.

Commands:

```text
npm run build
npx vitest run tests/unit/public-legal-pages.test.tsx
npx playwright test tests/e2e/public-footer-legal.spec.ts tests/e2e/public-workflows.spec.ts --grep 'shared footer|legal route|footer internal|public footer|footer keyboard|public pages reflow|observe fresh|landing page production|mobile navigation remains|Phase B public pages' --workers=2 --reporter=line --output=test-results/f2-artifacts
npx playwright test tests/e2e/public-footer-legal.spec.ts --grep 'footer internal links resolve' --workers=2 --reporter=line --output=test-results/f2-rerun
git diff --check
```

The selection runs all 48 new browser instances and six existing public-workflow instances; it excludes customer-tracking/tenant workflows unrelated to F2. No signup, registration, order, contact inquiry or external contact visit was submitted.

Browser checks cover all eight public routes at 320, 375, 390, 430, 561, 768, 1024 and 1440 CSS pixels; footer link dimensions and overflow; all internal footer destinations; legal direct loads, refresh and contents anchors; metadata; keyboard focus and tab order; and skip-to-content behavior. Reflow is also checked at 640 CSS pixels, equivalent to a 1280px window at 200% browser zoom. This is a reflow simulation, not native browser zoom or screen-reader certification. External WhatsApp hrefs are asserted without contacting WhatsApp.

Screenshots were visually inspected for the footer at 320, 561 and 1440px, and Privacy content at 320 and 1440px. Testing uses desktop Chromium and emulated mobile Chromium; physical devices, Safari and Firefox were not tested.

Earlier runs exposed initial-hash scrolling, a test locator made ambiguous by the new footer link, and insufficient time for a test performing 24 full-page navigations. The hash behavior was fixed; the existing test now scopes its WhatsApp assertion to the main content; the long navigation test has an explicit 90-second allowance. An initial CSS-zoom check was replaced with a clearly labeled zoom-equivalent reflow check because CSS zoom does not switch viewport media queries.

## Local storage/network observation

Fresh local browser visits to `/` and `/cookies` observed session-storage keys `serveflow.staff-tab-id` and `serveflow.waiter-tab-id`, no local-storage keys, no cookies and only the local development origin. External network requests were blocked by the new test suite; no external attempts occurred during these observations. No storage values or credentials were printed. Source also contains operational storage for authentication, cart/order context, tracking, language and staff preferences, depending on the workflow used.

These observations do not establish production cookies, hosting-injected scripts, authenticated storage, external-service behavior, request timing, analytics, or consent requirements. The Cookie Policy makes no no-cookie/no-tracking promise. No consent banner was added.

## Facts and launch decisions still pending

- Confirm the contracting operator/legal entity, public support email, and final commercial documents. No entity-registration relationship is asserted.
- Obtain qualified legal review, including applicable launch jurisdictions, privacy responsibilities, request handling, retention/deletion, service providers, processing locations, transfers, contract/refund/liability terms and consent requirements. The documents remain visibly draft and are not launch compliance certification.
- The founder-approved reviewed seven-day trial, 365-day annual paid term and continued historical access after expiry have known implementation/enforcement gaps from the prior audits. F2 does not fix or certify those controls; the Terms require direct confirmation and do not promise that enforcement is live.
- Confirm the production origin before adding canonical/page-specific social URLs. Verify deployed route rewrites, cookies, response headers, external requests and tracking/consent behavior in the actual hosting environment.

## Git and boundaries

Baseline: branch `main`, commit `a1d0df1e68df8e999f9c4458a9c95de93b392986`, initially clean. Final status: six modified tracked files and eight new source/test/report files (14 total), all listed above, local and uncommitted. Generated build metadata is restored to baseline; browser artifacts are moved outside the repository to the system temporary directory, `ServeFlow-F2-20261016-evidence`.

No deployment, publication, commit, push, dependency addition, migration, Supabase resource change, backend/authentication change, payment-enforcement change, authenticated-dashboard redesign, or printer change occurred. No later phase was started.

## F2 addition: public light/dark theme

The earlier implementation above was committed by the user before this addition. Addition baseline: clean `main` at `ff29a79` (`feat: Implement shared public footer and legal pages with metadata`). The original F2 verification history is retained above.

The header now has one sun/moon button, placed between Sign in and the hamburger on mobile and after the existing action group on desktop. Both homepage and shared public headers use the same component. Its accessible label describes the next action; native button keyboard behavior, visible focus and a 44px target are retained.

Existing theme infrastructure is specific to restaurant menu themes or authentication styling. The public site reuses the repository's local-storage approach with a separate `serveflow.public-theme` key, without changing those features. Explicit choices persist across routes and reloads. With no valid saved choice, the public site follows the operating system, including live preference changes. Preference reads/writes are guarded; failed persistence leaves the current toggle usable while the application remains loaded.

`index.html` initializes only the eight public marketing/legal paths before application loading, using a distinct `data-public-theme` attribute. Its critical background/color-scheme styles require that attribute. The component removes it when unmounted. Authenticated, authentication and QR route styles do not use this attribute. Dark colors coordinate page surfaces, navigation, menus, cards, buttons, footer, legal notices, text, links, borders and hover/focus states. There are no forms or inputs in these marketing/legal pages; authentication forms are outside this change.

The Cookie Policy now explicitly describes persistence of the public theme preference. Fresh visits without a user choice do not write that key.

### Addition file inventory

- `index.html`: public-only early initialization and critical canvas colors.
- `src/modules/landing/components/PublicThemeToggle.tsx`: shared theme control and preference lifecycle.
- `src/modules/landing/components/PublicSiteChrome.tsx`: shared header placement.
- `src/modules/landing/pages/LandingPage.tsx`: homepage header placement.
- `src/modules/landing/styles/landing.css`: scoped palette, interaction states and mobile spacing.
- `src/modules/landing/pages/PublicLegalPages.tsx`: theme storage disclosure.
- `tests/e2e/public-theme.spec.ts`: switching, persistence, system preference, initialization, isolation, responsive and computed-color checks.
- `docs/PUBLIC_WEBSITE_F2_REPORT.md`: this addition and final verification evidence.

### Addition verification

Commands run for this addition:

```text
npm run build
npx vitest run tests/unit/public-legal-pages.test.tsx
npx playwright test tests/e2e/public-theme.spec.ts --workers=2 --reporter=line --output=test-results/f2-theme
npx playwright test tests/e2e/public-theme.spec.ts tests/e2e/public-footer-legal.spec.ts tests/e2e/public-workflows.spec.ts --grep 'denied theme|keyboard switching|shared footer|legal route|footer internal|public footer|footer keyboard|public pages reflow|observe fresh|landing page production|mobile navigation remains|Phase B public pages' --workers=2 --reporter=line --output=test-results/f2-theme-regression
git diff --check
```

The build passed (2,355 modules; plugin-timing advisory only). Vitest passed one file / six tests. The first theme run passed 38 / failed two: the broad Storage API denial cases described below. All 32 theme/width browser cases passed, covering both themes on all eight routes at 320, 375, 390, 430, 561, 768, 1024 and 1440px in desktop and emulated mobile Chromium. Checks included control ordering and fit, 44px theme-button dimensions, menu opening, overflow and selected computed text colors. The early-init test also passed with application modules blocked, and confirmed no public theme attribute/color-scheme is applied on the sign-in route.

The final regression run passed **58 / 58** in 4.1 minutes: four updated theme test instances plus all 48 footer/legal and six existing public workflow instances. Together with the initial passing theme cases, all **94 distinct selected browser cases** have passing results. This is coverage across runs, not a claim of a single 94-test run. Screenshots were visually reviewed for the dark homepage at 320 and 1440px, About at 1024px, and the full legal page/menu/footer at 320px. Fresh default visits again observed no cookies, no local-storage keys and only the local origin; choosing a theme deliberately adds its preference key.

Final diff check passed. This addition changes six tracked files and adds two files (eight total, listed above), with no commit or push. Generated build metadata was restored; addition browser evidence was moved outside the repository to the system temporary directory, `ServeFlow-F2-theme-20261016-evidence`. No dependencies, dashboard theme code, backend resources, migrations, printer resources or deployment were changed. The original legal/production verification gaps remain pending.

Color tests measure selected actual computed foreground/background pairs on solid surfaces against a 4.5:1 threshold, including navigation, footer, legal notices and card text. This is a targeted regression check, not comprehensive accessibility certification. Native devices, screen readers, all gradients/images and deployed hosting remain outside local verification.

A test denying *all* Storage API calls exposed an existing bootstrap limitation: eagerly imported staff/session modules require browser storage before the public header loads. That broad denial prevents the application from rendering. These modules were preserved. The focused theme test denies only theme preference access to verify the new component's fallback; F2 does not claim the whole application works with all browser storage disabled.

### Footer spacing adjustment

Subsequent founder-requested homepage simplification: removed the repeated bottom “Start with ServeFlow / Set up your hospitality workspace” account-creation card from `LandingPage.tsx`. The existing hero Get started action and header sign-in access remain available. No replacement promotional block was added.

Homepage simplification checks: `npx playwright test tests/e2e/public-workflows.spec.ts --grep 'landing page production|mobile navigation remains' --workers=2 --reporter=line --output=test-results/f2-home-trim` passed 4/4 (desktop/mobile homepage smoke and 320px navigation); `git diff --check` passed. No build rerun for this single-section removal.

Removed the bottom footer logo/home and Sign in links on all public pages. Copyright remains. On mobile, top padding is now 32px, link-group gaps 20px, and the copyright separator uses 20px top margin / 16px padding. Existing 44px link targets remain. Header branding and sign-in access are unchanged.

Adjusted `PublicSiteChrome.tsx`, `landing.css`, the footer link expectations in `tests/e2e/public-footer-legal.spec.ts`, and this report. Six legal-content unit tests and `git diff --check` passed. Browser verification: `npx playwright test tests/e2e/public-footer-legal.spec.ts --grep 'shared footer|footer keyboard|reflow at 320px' --workers=2 --reporter=line --output=test-results/f2-footer-trim` passed 20/20 in 38.8 seconds. This covers all eight public-page footers, keyboard navigation and 320px reflow in both Chromium projects. No build rerun for this markup/style removal; the preceding theme build result is historical.
