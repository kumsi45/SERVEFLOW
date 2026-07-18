# ServeFlow regression suite

Run `npm run test:regression`. The runner always writes `test-results/REGRESSION_REPORT.md`, even when a test fails. Install Chromium once with `npx playwright install chromium`.

Unit and source-contract tests run without credentials. Browser and Supabase fixture tests skip explicitly until their environment is supplied; a skipped test is not production verification.

## Browser workflow environment

- `SERVEFLOW_QR_URL`, `SERVEFLOW_SECOND_QR_URL`
- `SERVEFLOW_WAITER_URL`, `SERVEFLOW_CASHIER_URL`, `SERVEFLOW_KITCHEN_URL`
- `SERVEFLOW_MANAGER_URL`, `SERVEFLOW_OWNER_URL`, `SERVEFLOW_INVENTORY_URL`
- `SERVEFLOW_REPORTS_URL`, `SERVEFLOW_AI_URL`

URLs must point to seeded disposable workflow fixtures. Playwright exercises Chromium desktop and mobile projects and retains failure screenshots, traces, and video.

## Guarded Supabase verification

Set `SERVEFLOW_ALLOW_TEST_WRITES=true` and `SERVEFLOW_TEST_PROJECT=true`, plus `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and tenant A/B/C/D access tokens and restaurant IDs. Use `SERVEFLOW_TENANT_A_TOKEN` through `SERVEFLOW_TENANT_D_TOKEN` with matching `_ID` variables.

Never use production customer records. Use a dedicated staging project containing four disposable restaurants and representative staff accounts.
