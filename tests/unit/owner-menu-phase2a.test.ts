import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(resolve(process.cwd(), "src/modules/owner/pages/OwnerDashboardPage.tsx"), "utf8");
const css = readFileSync(resolve(process.cwd(), "src/modules/owner/styles/ownerDashboard.css"), "utf8");

describe("Owner Menu Phase 2A", () => {
  it("keeps basic creation free of inventory configuration by default", () => {
    expect(page).toContain('setFormTrackingType("no_tracking")');
    expect(page).toContain("Default for ordinary items");
    expect(page).toContain("Advanced options");
  });

  it("keeps recipe and direct inventory explicit advanced choices", () => {
    expect(page).toContain("Direct Inventory");
    expect(page).toContain("For packaged products");
    expect(page).toContain("Automatic / default");
  });

  it("prioritizes searchable, availability-first menu operations", () => {
    expect(page).toContain("Manage what customers can order.");
    expect(page).toContain("Total items");
    expect(page).toContain('Mark {item.available ? "unavailable" : "available"}');
    expect(page).toContain("getCategoryName(categories, item.category_id).toLowerCase().includes(query)");
  });

  it("keeps the operational workspace compact on mobile", () => {
    expect(css).toContain(".od-menu-summary");
    expect(css).toContain(".od-menu-advanced");
    expect(css).toContain(".od-menu-experience .od-table thead{display:none}");
  });

  it("removes Menu Files and its workspace request from the primary menu", () => {
    expect(page).not.toContain("<details className=\"od-menu-secondary\"");
    expect(page).not.toContain("void loadMenuUploads()");
    expect(page).not.toContain("Upload file");
    expect(page).not.toContain("Uploaded Menu Files");
  });

  it("keeps compact icon actions without exposing descriptions", () => {
    expect(page).toContain("More actions for ${item.name}");
    expect(page).toContain('Mark {item.available ? "unavailable" : "available"}');
    expect(page).toContain("<Pencil aria-hidden");
    expect(page).not.toContain("className=\"od-menu-desc\"");
    expect(css).toContain(".od-menu-overflow-menu");
  });

  it("keeps basic add and edit fields ahead of mounted advanced configuration", () => {
    expect(page).toContain("+ Create new category");
    expect(page).toContain("Advanced options{modal.mode === \"edit\"");
    expect(page).toContain('setFormTrackingType("no_tracking")');
    expect(page).toContain("Visible and orderable on the customer menu");
    expect(css).toContain(".od-menu-availability");
    expect(css).toContain(".od-menu-photo-action");
  });

  it("uses a contained mobile sheet with reachable sticky actions", () => {
    expect(css).toContain(".od-menu-experience .od-modal{display:flex;flex-direction:column");
    expect(css).toContain(".od-menu-experience .od-staff-form{flex:1;min-height:0;overflow:auto");
    expect(css).toContain(".od-menu-experience .od-modal-actions{position:sticky");
    expect(page).toContain('<details className="od-menu-advanced">');
    expect(page).not.toContain('className="od-menu-advanced" open=');
  });

  it("reserves mobile advisor space and hides it while the menu sheet is active", () => {
    expect(css).toContain(".od-root:has(.od-menu-experience) .od-menu-experience{padding-bottom:calc(164px + env(safe-area-inset-bottom))}");
    expect(css).toContain(".od-root:has(.od-menu-experience .od-modal) > .sf-ai-launcher{display:none}");
    expect(css).toContain(".od-menu-experience .od-table tr{min-height:76px}");
  });
});
