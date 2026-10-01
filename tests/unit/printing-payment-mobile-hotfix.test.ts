import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
describe("Phase 11.2.1 mobile modal and default printer hotfix", () => {
  it("uses a document-body portal and a mobile safe-area bottom sheet", () => {
    const component = readFileSync(resolve(process.cwd(), "src/modules/owner/components/design-system/OwnerDesignSystem.tsx"), "utf8");
    const css = readFileSync(resolve(process.cwd(), "src/modules/owner/components/design-system/ownerDesignSystem.css"), "utf8");
    expect(component).toContain("createPortal");
    expect(component).toContain("document.body");
    expect(css).toContain("z-index:10000");
    expect(css).toContain("env(safe-area-inset-bottom)");
  });

  it("saves default replacement atomically and remains tenant authorized", () => {
    const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/211_phase11_2_1_atomic_default_printer.sql"), "utf8");
    expect(sql).toContain("public.has_staff_role");
    expect(sql).toContain("set is_default = false");
    expect(sql).toContain("insert into public.business_printers");
    expect(sql).not.toContain("alter table");
    expect(sql).not.toContain("create table");
  });
});
