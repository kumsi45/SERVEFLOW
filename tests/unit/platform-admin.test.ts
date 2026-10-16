import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { metric, isAdminSection, safeAdminError } from "../../src/modules/super-admin/platformAdminService";

describe("platform presentation boundaries", () => {
  it.each([null, undefined, NaN, -1, "12"])("does not fabricate a zero for %s", value => expect(metric(value)).toBe("Unavailable"));
  it("retains genuine zero and finite counts", () => { expect(metric(0)).toBe("0"); expect(metric(12)).toBe("12"); });
  it("recognizes only named platform sections", () => { expect(isAdminSection("overview")).toBe(true); expect(isAdminSection("execute-sql")).toBe(false); });
  it("does not expose backend error contents", () => {
    expect(safeAdminError({ message: "secret credential and personal record" })).not.toContain("secret");
    expect(safeAdminError({ code: "42501", message: "raw" })).toContain("MFA");
    expect(safeAdminError({ code: "40001" })).toContain("Refresh");
    expect(safeAdminError({ code: "PT409", message: "private backend detail" })).toContain("Refresh");
  });
});

describe("actual owner signup handler", () => {
  let handler: (request: Request) => Response;
  beforeAll(async () => {
    vi.stubGlobal("Deno", { serve: (callback: typeof handler) => { handler = callback; } });
    await import("../../supabase/functions/owner-signup/index");
    vi.unstubAllGlobals();
  });
  it.each([{}, { role: "super_admin" }, { signup_kind: "owner", approved: true }])("denies unreviewed metadata without creating accounts: %j", body => {
    const response = handler(new Request("http://localhost/owner-signup", { method: "POST", body: JSON.stringify(body) }));
    expect(response.status).toBe(403);
  });
  it("allows only CORS preflight and rejects other methods", () => {
    expect(handler(new Request("http://localhost/owner-signup", { method: "OPTIONS" })).status).toBe(200);
    expect(handler(new Request("http://localhost/owner-signup")).status).toBe(405);
  });
});

// These are source-contract checks, NOT execution of Postgres authorization/RLS.
describe("local SQL security contracts (integration remains unverified)", () => {
  const sql = readFileSync("supabase/migrations/276_platform_admin_foundation.sql", "utf8");
  const boundary = readFileSync("supabase/migrations/277_platform_admin_boundary_hardening.sql", "utf8");
  it("checks private named authorization, live session, recovery and MFA", () => {
    for (const required of ["where user_id=auth.uid()", "recovery_verified_at is not null", "auth.sessions", "auth.mfa_factors", "'aal2'", "interval '5 minutes'"]) expect(sql).toContain(required);
    expect(sql).not.toContain("user_metadata");
  });
  it("denies direct table access and pins definer paths", () => {
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql.match(/security definer/g)?.length).toBe(sql.match(/security definer set search_path=''/g)?.length);
    expect(sql).not.toContain("create policy");
  });
  it("derives audit actor and does not swallow critical audit failure", () => {
    expect(sql).toContain("values(auth.uid(),action_name");
    expect(sql).not.toContain("when others");
    expect(sql).toContain("platform_audit_request_idx");
    expect(sql).toContain("for update");
  });
  it("has fixed-duration constraints and no contract activation endpoint", () => {
    expect(sql).toContain("interval '168 hours'"); expect(sql).toContain("interval '8760 hours'");
    expect(sql).not.toMatch(/insert into platform_private\.contracts/);
    expect(sql).toContain("check(status in ('pending','rejected'))");
  });
  it("records no usable invitation or delivery claim", () => {
    expect(sql).toContain("check(token_digest is null and expires_at is null and consumed_at is null)");
    expect(sql).toContain("unique references platform_private.applications");
    expect(sql).not.toMatch(/grant .*platform_private\.invitations/);
  });
  it("retires global tenant-owner configuration and metadata provisioning", () => {
    expect(boundary).toContain("from public,anon,authenticated,service_role");
    expect(boundary).toContain("Owner provisioning requires an approved invitation workflow");
    expect(boundary).not.toMatch(/delete from|truncate |update public\.restaurants/i);
  });
});
