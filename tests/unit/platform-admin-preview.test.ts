import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
    expect(preview).toContain("Synthetic preview fixture");
    expect(preview).not.toMatch(/getPlatformAdminClient|readAdmin|adminMutation|\.rpc\(|fetch\(/);
    expect(page).toContain("if (preview) { setNotice");
  });

  it("labels synthetic data and keeps preview navigation in its own route namespace", () => {
    expect(page).toContain("PREVIEW — SYNTHETIC DATA");
    expect(preview).toContain("/platform-admin/preview/${section}");
    expect(page).toContain("Submitted forms never call administrative RPCs.");
  });
});
