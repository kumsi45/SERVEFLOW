import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Owner staff-management JWT handling", () => {
  it("refreshes the Owner session and explicitly sends the current access token", () => {
    const source = readFileSync(resolve(process.cwd(), "src/modules/owner/services/staffManagementService.ts"), "utf8");

    expect(source).toContain("supabase.auth.refreshSession()");
    expect(source).toContain("refreshedSession.session?.access_token");
    expect(source).toContain("headers: { Authorization: `Bearer ${accessToken}` }");
  });
});
