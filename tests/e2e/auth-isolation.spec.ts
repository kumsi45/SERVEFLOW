import { expect, test } from "@playwright/test";

type MatrixEntry = { restaurant: string; role: "owner" | "manager" | "cashier" | "kitchen" | "waiter"; loginUrl: string; email?: string; username?: string; password: string; expectedPath: string };
const raw = process.env.SERVEFLOW_AUTH_MATRIX_JSON;
const matrix = raw ? JSON.parse(raw) as MatrixEntry[] : [];

test("Restaurant A/B owner-manager-cashier-kitchen-waiter tabs remain isolated", async ({ browser }) => {
  test.skip(matrix.length !== 10, "Set SERVEFLOW_AUTH_MATRIX_JSON with the ten A/B role fixtures.");
  const context = await browser.newContext();
  const sessions: Array<{ entry: MatrixEntry; page: Awaited<ReturnType<typeof context.newPage>>; authKey: string }> = [];
  for (const entry of matrix) {
    const page = await context.newPage();
    await page.goto(entry.loginUrl);
    if (entry.role === "waiter") {
      await page.getByLabel(/username/i).fill(entry.username!);
      await page.getByLabel(/pin|password/i).fill(entry.password);
    } else {
      await page.getByLabel(/work email/i).fill(entry.email!);
      await page.getByLabel(/password/i).fill(entry.password);
    }
    await page.getByRole("button", { name: /continue|sign in|login/i }).click();
    await expect(page).toHaveURL(new RegExp(entry.expectedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const authKeys = await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.includes("serveflow-staff-auth:") || key.includes("serveflow-waiter-auth:")));
    expect(authKeys).toHaveLength(1);
    sessions.push({ entry, page, authKey: authKeys[0] });
  }
  expect(new Set(sessions.map((session) => session.authKey)).size).toBe(10);
  for (const session of sessions) {
    await session.page.reload();
    await expect(session.page).toHaveURL(new RegExp(session.entry.expectedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await session.page.screenshot({ path: `test-results/artifacts/auth-${session.entry.restaurant}-${session.entry.role}.png`, fullPage: true });
  }
  await context.close();
});
