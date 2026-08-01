import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const designSystem = readFileSync("src/modules/owner/components/design-system/OwnerDesignSystem.tsx", "utf8");
const designCss = readFileSync("src/modules/owner/components/design-system/ownerDesignSystem.css", "utf8");
const advisor = readFileSync("src/modules/owner/components/ai/OwnerAiAdvisor.tsx", "utf8");
const ownerPage = readFileSync("src/modules/owner/pages/OwnerDashboardPage.tsx", "utf8");

describe("ServeFlow Owner design system", () => {
  it("provides the reusable owner interface primitives", () => {
    for (const primitive of ["SfCard", "SfPageHeader", "SfChartFrame", "SfButton", "SfInput", "SfSelect", "SfTable", "SfDialog", "SfSidePanel", "SfSkeleton", "SfEmptyState", "SfErrorState", "SfIcon"]) {
      expect(designSystem).toContain(`export function ${primitive}`);
    }
  });

  it("defines responsive, accessible motion and dark-ready tokens", () => {
    expect(designCss).toContain("--sf-space-2:8px");
    expect(designCss).toContain("--sf-green-600");
    expect(designCss).toContain("prefers-reduced-motion:reduce");
    expect(designCss).toContain("prefers-color-scheme:dark");
    expect(designCss).toContain("min-height:44px");
  });

  it("mounts the presentation-only AI advisor globally", () => {
    expect(ownerPage).toContain("<OwnerAiAdvisor");
    expect(advisor).toContain("Suggested prompts");
    expect(advisor).toContain("Business context");
    expect(advisor).toContain("sf-ai-conversation");
    expect(advisor).toContain("disabled aria-describedby");
    expect(advisor).not.toMatch(/supabase|fetch\(|invoke\(/);
  });
});
