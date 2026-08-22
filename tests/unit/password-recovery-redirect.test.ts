import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePasswordRecoveryRedirectUrl } from "../../src/core/config/appUrl";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replaceAll("\r\n", "\n");
const forgot = read("src/modules/staff-auth/pages/ForgotPasswordPage.tsx");
const reset = read("src/modules/staff-auth/pages/ResetPasswordPage.tsx");
const router = read("src/app/router/AppRouter.tsx");
const login = read("src/modules/staff-auth/pages/StaffLoginPage.tsx");
const waiterLogin = read("src/modules/waiter-auth/pages/WaiterLoginPage.tsx");
const manageStaff = read("supabase/functions/manage-staff/index.ts");
const passwordSetup = read("supabase/functions/complete-staff-password-setup/index.ts");

describe("password recovery redirect", () => {
  it("resolves the trusted public origin to the reset route", () => {
    expect(resolvePasswordRecoveryRedirectUrl({ publicAppUrl: "https://app.serveflow.example/", production: true }))
      .toBe("https://app.serveflow.example/reset-password");
  });

  it.each([null, undefined, "null", "undefined", "", "not-a-url"])("rejects missing or malformed production configuration: %s", (publicAppUrl) => {
    expect(() => resolvePasswordRecoveryRedirectUrl({ publicAppUrl, production: true }))
      .toThrow("Password recovery is temporarily unavailable");
  });

  it.each(["http://localhost:5173", "http://127.0.0.1:5173", "http://[::1]:5173"])("rejects production loopback origin %s", (publicAppUrl) => {
    expect(() => resolvePasswordRecoveryRedirectUrl({ publicAppUrl, browserOrigin: "https://safe.example", production: true }))
      .toThrow("Password recovery is temporarily unavailable");
  });

  it("allows browser origin only for intentional development", () => {
    expect(resolvePasswordRecoveryRedirectUrl({ browserOrigin: "http://localhost:5173", production: false }))
      .toBe("http://localhost:5173/reset-password");
  });

  it("does not accept an arbitrary post-reset destination", () => {
    const result = resolvePasswordRecoveryRedirectUrl({ publicAppUrl: "https://safe.example/path?redirect=https://attacker.example", production: true });
    expect(result).toBe("https://safe.example/reset-password");
    expect(result).not.toContain("attacker.example");
  });

  it("sends the validated absolute redirect to Supabase Auth", () => {
    expect(forgot).toContain("resetPasswordForEmail(email.trim(), { redirectTo: getPasswordResetRedirectUrl() })");
  });

  it("registers and renders the reset-password route", () => {
    expect(router).toContain('pathname.match(/^\\/reset-password\\/?$/)');
    expect(router).toContain('route.name === "reset-password"');
    expect(router).toContain("<ResetPasswordPage />");
  });

  it("requires a valid Supabase recovery session and handles all supported token forms", () => {
    expect(reset).toContain('event === "PASSWORD_RECOVERY"');
    expect(reset).toContain("supabase.auth.setSession");
    expect(reset).toContain("supabase.auth.verifyOtp");
    expect(reset).toContain("supabase.auth.exchangeCodeForSession");
    expect(reset).toContain('setPageState("invalid")');
    expect(reset).toContain('setPageState("expired")');
  });

  it("uses shared password strength and confirmation validation", () => {
    expect(reset).toContain("validateStaffPasswordConfirmation(password, confirmPassword)");
  });

  it("updates through the trusted self-only Supabase Auth function", () => {
    expect(reset).toContain('"complete-staff-password-setup"');
    expect(passwordSetup).toContain("userClient.auth.getUser()");
    expect(passwordSetup).toContain("service.auth.admin.updateUserById(userData.user.id, { password })");
  });

  it("never stores, returns, or logs the password", () => {
    expect(passwordSetup).not.toMatch(/from\("restaurant_staff"\)\.(insert|update|upsert)[\s\S]{0,300}password/);
    expect(passwordSetup).not.toMatch(/console\.(log|info).*password/i);
    expect(passwordSetup).toContain("Passwords and request bodies must never be logged");
  });

  it("keeps Forgot Password on email/password login and out of Waiter PIN login", () => {
    expect(login).toContain('href="/forgot-password"');
    expect(waiterLogin).not.toContain("forgot-password");
    expect(waiterLogin).not.toContain("Forgot password");
  });

  it("requires configured APP_URL in the trusted staff reset function", () => {
    expect(manageStaff).toContain('normalizeResetBaseUrl(Deno.env.get("APP_URL"))');
    expect(manageStaff).not.toContain('request.headers.get("Origin")');
    expect(manageStaff).toContain("Password reset redirect URL is not configured");
    expect(manageStaff).toContain('hostname === "localhost"');
  });

  it("preserves tenant and active-membership authorization after identity recovery", () => {
    expect(passwordSetup).toContain('.eq("user_id", userData.user.id)');
    expect(passwordSetup).toContain('.eq("active", true)');
    expect(manageStaff).toContain("actingStaff.restaurant_id !== restaurantId");
  });
});
