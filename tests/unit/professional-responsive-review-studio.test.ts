import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/modules/setup-wizard/pages/restaurantSetupWizard.css"), "utf8");
const card = readFileSync(resolve(process.cwd(), "src/modules/setup-wizard/components/OwnerMenuItemCard.tsx"), "utf8");

describe("Phase 9.12.3.4 responsive Review Studio polish", () => {
  it("uses the spacious desktop three-column card contract", () => {
    expect(css).toContain("grid-template-columns: 220px minmax(0, 1fr) 260px");
    expect(css).toContain("width: 160px; height: 160px");
    expect(css).toContain("min-height: 120px");
  });

  it("uses dedicated tablet and mobile layouts", () => {
    expect(css).toContain("@media (min-width: 768px) and (max-width: 1199px)");
    expect(css).toContain("@media (max-width: 767px)");
    expect(css).toContain("width: 180px; height: 180px");
    expect(css).toContain("grid-template-rows: auto auto auto auto");
  });

  it("keeps image and accessibility performance behavior", () => {
    expect(card).toContain('loading="lazy"');
    expect(card).toContain('decoding="async"');
    expect(css).toContain("object-fit: cover");
    expect(css).toContain("min-height: 44px");
    expect(css).toContain(":focus-visible");
  });

  it("does not alter the card interaction contract", () => {
    for (const handler of ["onSelect", "onPhotoChange", "onPhotoRemove", "onNameChange", "onCategoryChange", "onDescriptionChange", "onPriceChange", "onRemove"]) {
      expect(card).toContain(handler);
    }
  });
});
