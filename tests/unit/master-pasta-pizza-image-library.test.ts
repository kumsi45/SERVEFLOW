import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const manifest = JSON.parse(readFileSync(resolve(root, "src/modules/setup-wizard/data/masterPastaPizzaImageLibrary.v1.json"), "utf8"));
const specifications = JSON.parse(readFileSync(resolve(root, "src/modules/setup-wizard/data/masterDishSpecifications.v1.json"), "utf8")).specifications;
const approved = specifications.filter((entry: { active: boolean; category: string }) => entry.active && ["Pasta", "Pizza"].includes(entry.category));

describe("Phase 9.13.6 Pasta and Pizza master images", () => {
  it("contains exactly every active dish in the approved categories", () => {
    expect(manifest.categories).toEqual(["Pasta", "Pizza"]);
    expect(manifest.images.map((entry: { dish_id: string }) => entry.dish_id).sort()).toEqual(approved.map((entry: { id: string }) => entry.id).sort());
    expect(manifest.images.filter((entry: { category: string }) => entry.category === "Pasta")).toHaveLength(5);
    expect(manifest.images.filter((entry: { category: string }) => entry.category === "Pizza")).toHaveLength(7);
    expect(manifest.images.some((entry: { dish_name: string }) => entry.dish_name === "Special Pizza")).toBe(false);
  });

  it("keeps all generated masters pending human review", () => {
    expect(manifest.lifecycle).toBe("PENDING_REVIEW");
    expect(manifest.images.every((entry: { lifecycle: string; lifecycle_history: string[] }) => entry.lifecycle === "PENDING_REVIEW" && entry.lifecycle_history.join(",") === "GENERATING,PENDING_REVIEW")).toBe(true);
  });

  it("provides immutable, valid, unique WebP responsive variants", () => {
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
        expect(variant.storage_path).toMatch(new RegExp(`^(restaurant|fast-food)/(pasta|pizza)/${entry.slug}/v001/${entry.slug}-v001-${variant.width}w\\.webp$`));
      }
    }
    expect(checksums.size).toBe(72);
  });
});
