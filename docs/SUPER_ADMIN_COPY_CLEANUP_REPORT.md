# Super Admin corrective visual cleanup

Date: 2026-10-20

## Findings

The rendered Applications preview had a full-width demo strip above the title, a separate refresh button beside the title, a standalone sort sentence, tall table rows, and large mobile cards. Businesses and Payments shared the same shell and filter layout; Payments also repeated the Business and Actions labels in phone cards. The source scan found no second page heading or repeated data-source footer in the other sections. Their status, permission, and recovery explanations carry distinct meaning and remain visible.

## Changes

- Moved the synthetic-data badge and Demo modes popover into the top bar. The badge remains visible on every preview page, including phones.
- Tightened the shared shell spacing and kept one primary heading per section. Shortened section-tab labels where they repeated the full heading.
- Grouped status filters, flexible search, and an accessible Refresh icon button into one responsive toolbar on Applications, Businesses, and Payments. On phones, search and Refresh share the first row and filters scroll in the second row.
- Removed the standalone Applications sort sentence. The Submitted header now shows a descending arrow and exposes `aria-sort="descending"`; the Submitted date remains in each record.
- Reduced table padding, badge size, dividers, and action weight. Approve remains the primary action; Reject is visually secondary. Reduced phone-card padding and removed repeated field labels where the business name or action is already clear.
- Kept phone toolbar and row buttons at least 44 pixels high. Shortened two bottom-tab captions at 320 pixels while retaining the full accessible names, and verified that adjacent labels do not overlap.
- Updated Playwright checks for the current preview controls and added layout assertions. Corrected two older unit assertions that referenced copy removed before this pass.

## Browser evidence

The local development preview was inspected in Chromium with external requests blocked. Before/after screenshots: [Applications desktop before](../test-results/before-applications-1440.png), [desktop after](../test-results/verified-applications-1440.png), [phone before](../test-results/before-applications-375.png), [phone after](../test-results/verified-applications-375.png). Final [Businesses phone](../test-results/verified-businesses-375.png) and [Payments phone](../test-results/verified-payments-375.png) screenshots were also inspected. The final visual review found one heading, a compact badge, an aligned toolbar, denser rows/cards, and no standalone sort line. The browser checks measured no document overflow at 1440, 375, and 320 pixels on the three review pages.

## Verification

- `npx tsc -b --pretty false`: passed.
- `npm run build`: passed.
- `npx vitest run tests/unit/platform-admin-design.test.ts tests/unit/platform-admin-preview.test.ts tests/unit/platform-admin.test.ts`: 24 passed.
- Focused desktop Chromium Playwright suite: 8 passed, covering preview modes, review actions, navigation, theme, and the new layout assertions.
- Expanded all-section hierarchy and overflow check: 14 sections passed at both 1440 and 375 pixels in desktop Chromium and in the mobile Chromium project. The first mobile run failed when localhost briefly returned `ERR_NETWORK_CHANGED` for two unrelated modules; the unchanged rerun passed. The final mobile toolbar check passed at 1440, 375, and 320 pixels, including touch-target and bottom-tab overlap assertions. Two mobile navigation and keyboard-focus checks passed.
- `git diff --check`: passed.

## Limits

The browser evidence covers the local synthetic preview. It does not certify a private authenticated administrator session or hosted behavior. No backend, database, Supabase configuration, printer resource, environment file, hosted service, deployment, commit, or push was changed.
