import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const qrMenuSource = read("src/modules/qr-menu/pages/QRMenuPage.tsx");
const globalCss = read("src/styles/global.css");

describe("public menu language dropdown", () => {
  it("uses one accessible dropdown instead of a floating button group", () => {
    expect(qrMenuSource).toContain('<select\n          value={menuLanguage}');
    expect(qrMenuSource).toContain('aria-label="Menu language"');
    expect(qrMenuSource).toContain("MENU_LANGUAGE_OPTIONS.map");
    expect(qrMenuSource).not.toContain('aria-pressed={menuLanguage === option.code}');
  });

  it("anchors the dropdown to the safe top-right corner", () => {
    expect(globalCss).toMatch(/\.qr-language-selector \{[\s\S]*?position: fixed;/);
    expect(globalCss).toContain("top: max(12px, env(safe-area-inset-top))");
    expect(globalCss).toContain("right: max(12px, env(safe-area-inset-right))");
    expect(globalCss).toMatch(/\.qr-language-selector select \{[\s\S]*?min-height: 44px;/);
  });
});
