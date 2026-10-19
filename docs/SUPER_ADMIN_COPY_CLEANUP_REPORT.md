# Super Admin copy cleanup report

Date: 2026-10-20

## Scope

This focused frontend pass removed duplicate visible copy without changing the data boundary, private authorization flow, RPCs, migrations, permissions, or deployment state.

## Patterns cleaned up

- Review-list empty states previously repeated a heading and an instruction that restated the available filters. Each now gives one direct result message.
- The generic record-list empty state no longer combines the result with unsupported-workflow implementation detail.
- Business detail drawers no longer repeat the business name in both the drawer heading and breadcrumb. The drawer heading is the single record identifier.
- Action dialogs now name the action precisely: Review classification, Approve application, Reject application, Reject payment, or Record payment.
- The preview action-dialog notice was removed because the development-only page already has one persistent `Demo data` indicator.

## Retained intentionally

- Page titles, navigation labels, group tabs, and distinct content headings such as Needs attention and Platform health.
- Screen-reader labels for search controls, tables, navigation, dialogs, and icon-only controls.
- Classification, payment, suspension/restoration, unknown/unavailable, MFA, recovery, and authorization disclosures because they explain a present state, consequence, or constraint.
- Technical references inside record detail drawers because they are optional supporting data, not a second record heading.

## Verification

- Added a Playwright check that Applications, Businesses, and Payments each render one visible page title and use concise filtered empty states.
- `npx tsc -b --pretty false` completed without diagnostics.
- The focused desktop/mobile copy Playwright test passed: 2 tests.
- `npx vite build` passed.
- `git diff --check` passed.

## Deliberate non-changes

No backend, Supabase, migration, Edge Function, permission, MFA, recovery, printer, environment, deployment, commit, or push work was performed.
