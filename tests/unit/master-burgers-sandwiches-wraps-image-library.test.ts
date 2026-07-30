import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const manifest = JSON.parse(readFileSync(resolve(root, "src/modules/setup-wizard/data/masterBurgersSandwichesWrapsImageLibrary.v1.json"), "utf8"));
const specs = JSON.parse(readFileSync(resolve(root, "src/modules/setup-wizard/data/masterDishSpecifications.v1.json"), "utf8")).specifications;
const approved = specs.filter((entry: { active: boolean; category: string }) => entry.active && ["Burgers", "Sandwiches", "Wraps"].includes(entry.category));

describe("Phase 9.13.7 Burgers Sandwiches Wraps master images", () => {
  it("contains exactly every active approved dish", () => {
    expect(manifest.categories).toEqual(["Burgers", "Sandwiches", "Wraps"]);
    expect(manifest.images.map((entry: { dish_id: string }) => entry.dish_id).sort()).toEqual(approved.map((entry: { id: string }) => entry.id).sort());
    expect(manifest.images.filter((entry: { category: string }) => entry.category === "Burgers")).toHaveLength(4);
    expect(manifest.images.filter((entry: { category: string }) => entry.category === "Sandwiches")).toHaveLength(5);
    expect(manifest.images.filter((entry: { category: string }) => entry.category === "Wraps")).toHaveLength(3);
  });

  it("keeps every master pending human review", () => {
    expect(manifest.lifecycle).toBe("PENDING_REVIEW");
    expect(manifest.images.every((entry: { lifecycle: string; lifecycle_history: string[] }) => entry.lifecycle === "PENDING_REVIEW" && entry.lifecycle_history.join(",") === "GENERATING,PENDING_REVIEW")).toBe(true);
  });

  it("provides 72 immutable valid unique WebP variants", () => {
    const checksums = new Set<string>();
    for (const entry of manifest.images) {
      expect(entry.responsive_variants.map((variant: { width: number }) => variant.width)).toEqual([2048, 1280, 1024, 768, 512, 320]);
      for (const variant of entry.responsive_variants) {
        const bytes = readFileSync(resolve(root, "public/smart-menu-images", variant.storage_path));
        const checksum = createHash("sha256").update(bytes).digest("hex");
        expect(checksum).toBe(variant.checksum_sha256);
        expect(checksums.has(checksum)).toBe(false);
        checksums.add(checksum);
        expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
        expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
        expect(variant.storage_path).toMatch(new RegExp(`^(restaurant|fast-food)/(burgers|sandwiches|wraps)/${entry.slug}/v001/${entry.slug}-v001-${variant.width}w\\.webp$`));
      }
    }
    expect(checksums.size).toBe(72);
  });
});
