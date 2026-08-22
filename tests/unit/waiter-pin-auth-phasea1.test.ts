import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { waiterPinFingerprint } from "../../supabase/functions/_shared/waiterPin";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/228_phasea1_waiter_pin_authentication.sql");
const endpoint = read("supabase/functions/waiter-pin-login/index.ts");
const manageStaff = read("supabase/functions/manage-staff/index.ts");
const service = read("src/modules/waiter-auth/services/waiterAuthService.ts");
const page = read("src/modules/waiter-auth/pages/WaiterLoginPage.tsx");
const components = read("src/modules/waiter-auth/components/WaiterLoginTerminal.tsx");
const dashboard = read("src/modules/waiter-dashboard/pages/WaiterDashboardPage.tsx");

describe("Phase A1 waiter PIN authentication", () => {
  it("creates tenant-scoped opaque PIN fingerprints", async () => {
    const pepper = "test-only-pepper-that-is-longer-than-thirty-two-characters";
    const first = await waiterPinFingerprint(pepper, "restaurant-a", "1234");
    const same = await waiterPinFingerprint(pepper, "restaurant-a", "1234");
    const otherTenant = await waiterPinFingerprint(pepper, "restaurant-b", "1234");

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(same);
    expect(first).not.toBe(otherTenant);
    expect(first).not.toContain("1234");
  });

  it("keeps credentials server-only and unique per active restaurant PIN", () => {
    expect(migration).toContain("create table if not exists public.waiter_pin_credentials");
    expect(migration).toContain("waiter_pin_credentials_active_pin_unique");
    expect(migration).toContain("where active = true");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on table public.waiter_pin_credentials from public, anon, authenticated");
    expect(migration).not.toMatch(/\bpin\s+text\b/i);
  });

  it("uses one trusted endpoint with throttling and normal Supabase password auth", () => {
    expect(endpoint).toContain("requireWaiterPinPepper");
    expect(endpoint).toContain("waiterThrottleFingerprint");
    expect(endpoint).toContain("RATE_LIMIT = 5");
    expect(endpoint).toContain("waiterSupabasePassword(pepper, restaurant.id, staff.employee_id)");
    expect(endpoint).toContain("signInWithPassword({ email: staff.email, password: authPassword })");
    expect(endpoint).toContain('staff.role !== "waiter"');
    expect(endpoint).toContain("authData.user.id !== staff.user_id");
    expect(endpoint).toContain('rpc("record_waiter_login"');
    expect(endpoint).not.toContain("SUPABASE_SERVICE_ROLE_KEY,");
    expect(endpoint).not.toMatch(/pin:\s*pin[,}]/);
  });

  it("enrolls waiter creation and reset without storing plaintext PINs", () => {
    expect(manageStaff).toContain("prepareWaiterPinFingerprint");
    expect(manageStaff).toContain("saveWaiterPinCredential");
    expect(manageStaff).toContain('action === "set-waiter-pin"');
    expect(manageStaff).not.toContain("generateAvailableWaiterPin");
    expect(manageStaff).toContain("waiterSupabasePassword");
    expect(manageStaff).toContain("This PIN is already used by another active waiter in this restaurant.");
    expect(manageStaff).toContain('targetStaff.role === "waiter"');
  });

  it("renders the minimal entry and masked keypad without a waiter directory", () => {
    expect(page).toContain("Waiter Ordering Terminal");
    expect(page).toContain("Waiter Login");
    expect(page).toContain("Enter PIN");
    expect(page).toContain("signInWaiterWithPin");
    expect(page).toContain("openWaiterDashboard(result.session.restaurant.slug)");
    expect(page).not.toContain("loadWaiterTerminalProfiles");
    expect(page).not.toContain("resolveWaiterTerminalProfile");
    expect(page).not.toContain("WaiterGrid");
    expect(page).not.toContain("window.location.replace");
    expect(components).toContain("PinIndicator");
    expect(components).toContain('aria-label="Delete last digit"');
  });

  it("establishes the Supabase session and clears waiter state before async logout", () => {
    expect(service).toContain("/functions/v1/waiter-pin-login");
    expect(service).toContain("waiterSupabase.auth.setSession");
    expect(service).toContain("consumePrefetchedWaiterTables");
    expect(service).toContain("get_waiter_dashboard_tables");
    expect(service).toContain("clearWaiterSensitiveClientState");
    expect(service.indexOf("clearWaiterSensitiveClientState(session?.restaurant.slug)"))
      .toBeLessThan(service.indexOf('rpc("record_waiter_logout"'));
    expect(dashboard).toContain("const logout = signOutWaiter();");
    expect(dashboard.indexOf("setTables([])"))
      .toBeLessThan(dashboard.indexOf("void logout.catch"));
    expect(dashboard).toContain("navigateWaiter(`/waiter/${encodeURIComponent(restaurantSlug)}${suffix}`, true)");
  });
});
