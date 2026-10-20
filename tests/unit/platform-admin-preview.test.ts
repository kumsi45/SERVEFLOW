import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { previewRead } from "../../src/modules/super-admin/PlatformAdminPreviewPage";
import { contractTiming } from "../../src/modules/super-admin/PlatformAdminWorkspace";

describe("preview records and date-based presentation", () => {
  it("filters before pagination and preserves distinct cursor pages", () => {
    const first = previewRead("businesses", "", "", null);
    const next = previewRead("businesses", "", "", first.nextCursor ?? null);
    expect(first.items).toHaveLength(4);
    expect(next.items).toHaveLength(3);
    expect(next.items?.some(row => first.items?.some(previous => previous.id === row.id))).toBe(false);
    expect(previewRead("businesses", "Acacia", "live", null).items).toHaveLength(1);
    expect(previewRead("businesses", "Acacia", "demo", null).items).toHaveLength(0);
    expect(previewRead("audit-logs", "", "", null, "2026-01-15", "2026-01-15").items).toHaveLength(1);
  });
  it("does not turn missing dates into an active contract or entitlement", () => {
    expect(contractTiming(null, null, "2026-01-15")).toBe("Unavailable");
    expect(contractTiming("2026-01-01", "2027-01-01", "2026-01-15")).toBe("Within term");
    expect(contractTiming("2026-01-01", "2026-01-20", "2026-01-15")).toBe("Ends within 30 days");
    expect(contractTiming("2025-01-01", "2026-01-01", "2026-01-15")).toBe("Term ended");
  });
});

describe("platform administrator visual preview boundary", () => {
  const router = readFileSync("src/app/router/AppRouter.tsx", "utf8");
  const page = readFileSync("src/modules/super-admin/PlatformAdminPage.tsx", "utf8");
  const preview = readFileSync("src/modules/super-admin/PlatformAdminPreviewPage.tsx", "utf8");

  it("exposes the preview route and module only behind Vite development mode", () => {
    expect(router).toContain("if (import.meta.env.DEV)");
    expect(router).toMatch(/PlatformAdminPreviewPage = import\.meta\.env\.DEV\s*\?/);
    expect(page).toContain('if (preview && !import.meta.env.DEV) throw new Error');
  });

  it("keeps synthetic fixtures separate from platform clients and privileged calls", () => {
    expect(preview).toContain('const source = "Demo data"');
    expect(preview).not.toMatch(/getPlatformAdminClient|readAdmin|adminMutation|\.rpc\(|fetch\(/);
    expect(page).toContain("preview?.dataSource ?? privateAdminDataSource");
    expect(preview).toContain("createPreviewAdminDataSource");
  });

  it("labels synthetic data and keeps preview navigation in its own route namespace", () => {
    expect(page).toContain("<DemoBanner />");
    expect(preview).toContain("/platform-admin/preview/${section}");
    expect(page).toContain("Demo decision saved for this preview session.");
  });
});
