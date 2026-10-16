import { expect, test, type Page } from "@playwright/test";

// SYNTHETIC UI CONTRACT FIXTURES ONLY. No Auth/SQL/RLS enforcement is simulated as certification.
const identity = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const business = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const rowId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const sections = ["overview", "applications", "businesses", "users", "contracts", "payments", "notifications", "system-health", "diagnostics", "integrations", "backups", "audit-logs", "administrators", "security"];
type FixtureOptions = { session?: boolean; denied?: boolean; mfa?: boolean; recovery?: boolean; failRead?: boolean; failAction?: boolean };
async function isolate(page: Page, baseURL: string | undefined, options: FixtureOptions = {}) {
  if (!baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) throw new Error("SA2 UI fixtures require localhost.");
  const writes: Array<{ name: string; body: Record<string, unknown> }> = [];
  let verified = !options.mfa;
  const token = () => {
    const payload = { sub: identity, exp: Math.floor(Date.now() / 1000) + 3600, aal: verified ? "aal2" : "aal1", role: "authenticated" };
    return `synthetic.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.synthetic`;
  };
  const user = { id: identity, aud: "authenticated", role: "authenticated", email: "synthetic-admin@example.invalid", factors: [{ id: rowId, factor_type: "totp", status: "verified", friendly_name: "Synthetic factor", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }] };
  const session = () => ({ access_token: token(), refresh_token: "synthetic-never-valid", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user });
  if (options.session !== false) await page.addInitScript(value => {
    sessionStorage.setItem("serveflow.platform-admin.tab", "sa2-synthetic");
    sessionStorage.setItem("serveflow-platform-admin:sa2-synthetic", JSON.stringify(value));
  }, session());
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(baseURL).origin) return route.continue();
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (url.pathname.endsWith("/auth/v1/user")) return json(user);
    if (url.pathname.includes("/auth/v1/factors/") && url.pathname.endsWith("/challenge")) return json({ id: "synthetic-challenge", expires_at: Math.floor(Date.now() / 1000) + 60 });
    if (url.pathname.includes("/auth/v1/factors/") && url.pathname.endsWith("/verify")) { verified = true; return json(session()); }
    if (url.pathname.includes("/auth/v1/logout")) return json({});
    const name = url.pathname.split("/rpc/")[1];
    if (!name) return route.abort("blockedbyclient");
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (name === "get_platform_admin_context") return options.denied ? json({ code: "42501", message: "synthetic authorization denial" }, 403) : json({ userId: identity, displayName: "Synthetic administrator", recoveryVerified: options.recovery !== false, mfaRequired: !verified, canManage: true, canSensitive: true });
    if (name === "platform_admin_record_access" || name === "platform_admin_record_diagnostic") return json(null);
    if (name !== "platform_admin_read") {
      writes.push({ name, body });
      return options.failAction ? json({ code: "40001", message: "synthetic conflict" }, 409) : json({ ok: true });
    }
    if (options.failRead) return json({ code: "PGRST202", message: "synthetic missing migration" }, 404);
    const section = body.section;
    const common = { asOf: "2026-10-16T12:00:00Z", source: "SYNTHETIC UI CONTRACT FIXTURE" };
    if (section === "overview") return json({ ...common, pendingApplications: 2, rejectedApplications: 0, pendingPayments: 1, approvedBusinesses: null, activeContracts: null, limitation: "Enforcement unavailable in synthetic fixture." });
    if (section === "system-health") return json({ ...common, database: { status: "Healthy", meaning: "Synthetic query result, not real service health." }, auth: "Unknown", frontend: "Unknown", storage: "Unknown", realtime: "Unknown", edgeFunctions: "Unknown" });
    if (["integrations", "backups", "security"].includes(String(section))) return json({ ...common, mfa: "Synthetic MFA boundary description." });
    const row = { id: rowId, created_at: "2026-10-15T12:00:00Z", name: "Synthetic hospitality business", business_name: "Synthetic hospitality business", slug: "synthetic-business", classification: "unclassified", version: 0, owners: [{ name: "Synthetic owner" }], entitlement: "Unavailable", status: "pending", display_name: "Synthetic member", role: "owner", active: true, contact_name: "Synthetic applicant", contact_email: "synthetic@example.invalid", business_type: "cafe", amount: 10, currency: "ETB", channel: "Synthetic test channel", reference: "SYNTHETIC-ONLY", restaurant_id: business };
    return json({ ...common, items: [row], nextCursor: body.cursor_at ? null : { at: row.created_at, id: rowId } });
  });
  return writes;
}

test("unauthenticated admin routes show private login without fetching protected data", async ({ page, baseURL }) => {
  await isolate(page, baseURL, { session: false });
  const reads: string[] = []; page.on("request", request => { if (request.url().includes("/rpc/platform_admin_read")) reads.push(request.url()); });
  await page.goto("/platform-admin/overview");
  await expect(page.getByRole("heading", { name: "Administrator sign in" })).toBeVisible();
  await expect(page.getByRole("link", { name: /register|sign up/i })).toHaveCount(0);
  expect(reads).toHaveLength(0);
});

test("closed application intake collects no registration credentials", async ({ page, baseURL }) => {
  const writes = await isolate(page, baseURL, { session: false });
  await page.goto("/sign-up");
  await expect(page.getByRole("heading", { name: "New business applications are not open yet" })).toBeVisible();
  await expect(page.locator("form,input")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/staff-login");
  expect(writes).toHaveLength(0);
});

test("tenant authorization rejection never displays the admin shell", async ({ page, baseURL }) => {
  await isolate(page, baseURL, { denied: true });
  await page.goto("/platform-admin/businesses");
  await expect(page.getByRole("heading", { name: "Administrator sign in" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Platform administration" })).toHaveCount(0);
});

test("unverified recovery fails closed", async ({ page, baseURL }) => {
  await isolate(page, baseURL, { recovery: false }); await page.goto("/platform-admin/payments");
  await expect(page.getByRole("heading", { name: "Recovery review required" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Record submitted payment" })).toHaveCount(0);
});

test("MFA verification is required before the protected shell", async ({ page, baseURL }) => {
  await isolate(page, baseURL, { mfa: true }); await page.goto("/platform-admin/overview");
  await expect(page.getByRole("heading", { name: "Verify your authenticator" })).toBeVisible();
  await page.getByLabel("Authenticator code").fill("123456");
  await page.getByRole("button", { name: "Verify MFA", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
});

test("classification requires confirmation and sends no actor or authority fields", async ({ page, baseURL }) => {
  const writes = await isolate(page, baseURL); await page.goto("/platform-admin/businesses");
  await page.getByRole("button", { name: "Review classification" }).click();
  await expect(page.getByRole("button", { name: "Confirm decision" })).toBeDisabled();
  await page.getByLabel("Reviewed classification").selectOption("demo");
  await page.getByLabel("Decision reason").fill("Synthetic reviewed demo classification");
  await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "Confirm decision" }).click();
  await expect(page.locator(".pa-success")).toContainText("server audit");
  expect(writes).toHaveLength(1);
  expect(writes[0].name).toBe("platform_admin_classify");
  expect(writes[0].body).not.toHaveProperty("actor_id"); expect(writes[0].body).not.toHaveProperty("role");
  expect(writes[0].body.request_id).toMatch(/^[0-9a-f-]{36}$/);
});

test("missing service data is unavailable and never produces fake overview zeroes", async ({ page, baseURL }) => {
  await isolate(page, baseURL, { failRead: true }); await page.goto("/platform-admin/overview");
  await expect(page.getByRole("alert")).toContainText("unavailable");
  await expect(page.locator(".pa-metrics")).toHaveCount(0);
});

test("application approval does not claim invitation delivery or provisioning", async ({ page, baseURL }) => {
  const writes = await isolate(page, baseURL); await page.goto("/platform-admin/applications");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByLabel("Decision reason").fill("Synthetic application review");
  await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "Confirm decision" }).click();
  await expect(page.locator(".pa-success")).toContainText("no email or account was created");
  expect(writes[0].name).toBe("platform_admin_decide_application");
  expect(writes[0].body.decision).toBe("approved");
});

test("failed mutation never confirms success and retries retain the operation identity", async ({ page, baseURL }) => {
  const writes = await isolate(page, baseURL, { failAction: true }); await page.goto("/platform-admin/businesses");
  await page.getByRole("button", { name: "Review classification" }).click();
  await page.getByLabel("Decision reason").fill("Synthetic conflict review"); await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Confirm decision" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("conflicts");
  await expect(page.locator(".pa-success")).toHaveCount(0);
  await page.getByRole("button", { name: "Confirm decision" }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[0].body.request_id).toBe(writes[1].body.request_id);
});

test("payment review cannot approve contracts and audit dates reach the bounded query", async ({ page, baseURL }) => {
  await isolate(page, baseURL); await page.goto("/platform-admin/payments");
  await expect(page.getByRole("button", { name: /approve|activate|renew/i })).toHaveCount(0);
  await page.goto("/platform-admin/audit-logs");
  const request = page.waitForRequest(request => request.url().includes("/rpc/platform_admin_read") && request.postDataJSON().since_at === "2026-10-01T00:00:00.000Z");
  await page.getByLabel("From date (UTC)").fill("2026-10-01");
  await request;
});

test("missing entitlement and backup evidence remain unavailable", async ({ page, baseURL }) => {
  await isolate(page, baseURL); await page.goto("/platform-admin/overview");
  await expect(page.locator(".pa-metrics section").filter({ has: page.getByRole("heading", { name: "Active annual contracts" }) })).toContainText("Unavailable");
  await page.goto("/platform-admin/backups");
  await expect(page.getByText("Unknown — no verified backup evidence available")).toHaveCount(4);
  await expect(page.getByRole("button", { name: /^restore$/i })).toHaveCount(0);
});

test("keyset pagination and legacy route retirement are explicit", async ({ page, baseURL }) => {
  await isolate(page, baseURL); await page.goto("/platform-admin/businesses");
  await expect(page.getByRole("button", { name: "Next page" })).toBeEnabled();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();
  await page.goto("/admin/dashboard");
  await expect(page.getByText("This legacy administration route is retired.")).toBeVisible();
});

for (const width of [320, 390, 768, 1440]) {
  test(`all admin sections reflow and mobile navigation works at ${width}px`, async ({ page, baseURL }, testInfo) => {
    test.setTimeout(90_000);
    await isolate(page, baseURL); await page.setViewportSize({ width, height: 900 });
    for (const section of sections) {
      await page.goto(`/platform-admin/${section}`);
      await expect(page.locator(".pa-content h1")).toBeVisible();
      const titleContrast = await page.evaluate(() => {
        const lum = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
        const foreground = lum(getComputedStyle(document.querySelector(".pa-content h1")!).color);
        const background = lum(getComputedStyle(document.querySelector(".pa-root")!).backgroundColor);
        return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
      });
      expect(titleContrast, section).toBeGreaterThanOrEqual(4.5);
      await expect(page.getByText("SYNTHETIC UI CONTRACT FIXTURE", { exact: false })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), section).toBe(true);
    }
    if (width <= 1000) {
      await page.getByRole("button", { name: "Open platform navigation" }).click();
      const menu = page.getByRole("dialog", { name: "Platform navigation" });
      await expect(menu).toBeVisible();
      await page.keyboard.press("Escape"); await expect(menu).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Open platform navigation" })).toBeFocused();
    }
    await page.screenshot({ path: testInfo.outputPath(`sa2-synthetic-${width}.png`) });
  });
}
