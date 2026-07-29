import { describe, expect, it } from "vitest";
import { createSafeMenuDescription, SERVEFLOW_MENU_PLACEHOLDER_IMAGE } from "../../src/modules/setup-wizard/services/ownerMenuItemDefaults";

describe("owner menu item defaults", () => {
  it.each(["Chicken Burger", "Special Tibs", "Macchiato", "Chef Special"])("creates a safe short description for %s", (name) => {
    const description = createSafeMenuDescription(name);
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(160);
    expect(description).not.toContain("\n");
  });

  it("uses the ServeFlow placeholder image", () => {
    expect(SERVEFLOW_MENU_PLACEHOLDER_IMAGE).toMatch(/^data:image\/svg\+xml/);
    expect(decodeURIComponent(SERVEFLOW_MENU_PLACEHOLDER_IMAGE)).toContain("ServeFlow Menu");
  });
});
