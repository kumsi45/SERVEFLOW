import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/modules/manager/styles/managerLayout.css"), "utf8");

describe("Manager mobile document flow", () => {
  it("releases the shared viewport lock below desktop width", () => {
    expect(styles).toMatch(/@media \(max-width: 1023px\)[\s\S]*?\.ml-shell \{[\s\S]*?height: auto;[\s\S]*?overflow-y: visible;/);
    expect(styles).toMatch(/@media \(max-width: 1023px\)[\s\S]*?\.ml-workspace \{[\s\S]*?height: auto;[\s\S]*?overflow-y: visible;/);
    expect(styles).toMatch(/@media \(max-width: 1023px\)[\s\S]*?\.ml-content \{[\s\S]*?overflow-y: visible;/);
  });

  it("keeps bottom content and operational rails in normal responsive flow", () => {
    for (const selector of [".md-side", ".md-recent", ".moc-shift", ".moc-recent", ".mor-chart-card", ".mri-section"]) expect(styles).toContain(selector);
    expect(styles).not.toContain(".ml-content .md-ai-entry");
    expect(styles).toMatch(/\.ml-content \.md-recent,[\s\S]*?position: static;/);
  });

  it("removes non-modal AI nested scrolling on mobile and tablet", () => {
    expect(styles).toMatch(/\.ml-content \.cop-conversation \{[\s\S]*?max-height: none;[\s\S]*?overflow-y: visible;/);
    expect(styles).toMatch(/\.ml-content \.cop-chat \{[\s\S]*?min-height: 0;[\s\S]*?overflow: visible;/);
  });
});
