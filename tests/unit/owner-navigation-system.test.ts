import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/modules/owner/pages/OwnerDashboardPage.tsx", "utf8");
const styles = readFileSync("src/modules/owner/styles/ownerDashboard.css", "utf8");
const aiAdvisor = readFileSync("src/modules/owner/components/ai/OwnerAiAdvisor.tsx", "utf8");

describe("Phase 10A owner navigation system", () => {
  it("uses one grouped desktop information architecture", () => {
    expect(source).toContain('label: "Operations"');
    expect(source).toContain('label: "Business"');
    expect(source).toContain('label: "Business management"');
    expect(source).toContain('label: "Finance"');
    expect(source).toContain('label: "Printing"');
    expect(source).toContain("NAV_SECTIONS.map");
  });

  it("provides the complete mobile navigation map and support utilities", () => {
    expect(source).toContain('aria-label="Complete owner navigation"');
    expect(source).toContain("Operations");
    expect(source).toContain("Management");
    expect(source).toContain("Subscription");
    expect(source).toContain("Help Center");
    expect(source).toContain("About ServeFlow");
    expect(source).toContain("Send Feedback");
    expect(source).not.toContain('aria-label="All owner dashboard sections"');
  });

  it("keeps exactly five operational mobile destinations", () => {
    const mobileBlock = source.slice(source.indexOf('aria-label="Owner mobile navigation"'));
    for (const label of ["Dashboard", "Orders", "Menu", "Kitchen", "Settings"]) expect(mobileBlock).toContain(`label: "${label}"`);
  });

  it("provides a global non-navigating AI assistant shell", () => {
    expect(source).toContain("<OwnerAiAdvisor");
    expect(aiAdvisor).toContain("sf-ai-launcher");
    expect(aiAdvisor).toContain("SfSidePanel");
    expect(source).toContain("setAiAssistantOpen(true)");
    expect(styles).toContain(".od-sidebar.collapsed");
    expect(styles).toContain("@media(min-width:761px) and (max-width:1080px)");
  });

  it("includes the full Help, About, and Feedback UI shells", () => {
    for (const topic of ["Getting Started", "Orders", "Menu", "Kitchen", "Inventory", "Finance", "Printing", "Frequently Asked Questions", "Video Tutorials", "Contact Support"]) expect(source).toContain(topic);
    expect(source).toContain("KumsiTech");
    expect(source).toContain("Abdulhayi Alo");
    expect(source).toContain("v1.0.0");
    expect(source).toContain("Report Bug");
    expect(source).toContain("Suggest Feature");
    expect(source).toContain("Rate Experience");
  });
});
