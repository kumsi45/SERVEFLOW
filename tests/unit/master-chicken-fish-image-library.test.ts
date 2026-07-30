import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const manifest = JSON.parse(readFileSync(resolve(root, "src/modules/setup-wizard/data/masterChickenFishImageLibrary.v1.json"), "utf8"));
const specifications = JSON.parse(readFileSync(resolve(root, "src/modules/setup-wizard/data/masterDishSpecifications.v1.json"), "utf8")).specifications;
const approved = specifications.filter((entry: { active: boolean; category: string }) => entry.active && ["Chicken", "Fish & Seafood"].includes(entry.category));

describe("Phase 9.13.5 Chicken and Fish Seafood master images", () => {
  it("contains exactly every active dish in the two approved categories", () => {
    expect(manifest.categories).toEqual(["Chicken", "Fish & Seafood"]);
    expect(manifest.images.map((entry: { dish_id: string }) => entry.dish_id).sort()).toEqual(approved.map((entry: { id: string }) => entry.id).sort());
    expect(manifest.images.filter((entry: { category: string }) => entry.category === "Chicken")).toHaveLength(5);
    expect(manifest.images.filter((entry: { category: string }) => entry.category === "Fish & Seafood")).toHaveLength(4);
  });

  it("keeps all generated images pending human review", () => {
    expect(manifest.lifecycle).toBe("PENDING_REVIEW");
    expect(manifest.images.every((entry: { lifecycle: string; lifecycle_history: string[] }) => entry.lifecycle === "PENDING_REVIEW" && entry.lifecycle_history.join(",") === "GENERATING,PENDING_REVIEW")).toBe(true);
  });

  it("provides immutable, valid, unique WebP responsive variants", async () => {
    const checksums = new Set<string>();
    for (const entry of manifest.images) {
      expect(entry.responsive_variants.map((variant: { width: number }) => variant.width)).toEqual([2048, 1280, 1024, 768, 512, 320]);
      for (const variant of entry.responsive_variants) {
        const path = resolve(root, "public/smart-menu-images", variant.storage_path);
        const bytes = readFileSync(path);
        const checksum = createHash("sha256").update(bytes).digest("hex");
        expect(checksum).toBe(variant.checksum_sha256);
        expect(checksums.has(checksum)).toBe(false);
        checksums.add(checksum);
        expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
        expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
        expect(variant.storage_path).toMatch(new RegExp(`^restaurant/(chicken|fish-seafood)/${entry.slug}/v001/${entry.slug}-v001-${variant.width}w\\.webp$`));
      }
    }
    expect(checksums.size).toBe(54);
  });
});
