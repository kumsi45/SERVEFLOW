import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const manifest = JSON.parse(readFileSync(resolve(root, "src/modules/setup-wizard/data/masterCoffeeTeaHotDrinksImageLibrary.v1.json"), "utf8"));
const specs = JSON.parse(readFileSync(resolve(root, "src/modules/setup-wizard/data/masterDishSpecifications.v1.json"), "utf8")).specifications;
const approved = specs.filter((entry: { active: boolean; category: string }) => entry.active && ["Coffee", "Tea", "Hot Drinks"].includes(entry.category));

describe("Phase 9.13.9 Coffee Tea Hot Drinks master images", () => {
  it("contains exactly every active approved dish", () => {
    expect(manifest.phase).toBe("9.13.9");
    expect(manifest.categories).toEqual(["Coffee", "Tea", "Hot Drinks"]);
    expect(manifest.images.map((entry: { dish_id: string }) => entry.dish_id).sort()).toEqual(approved.map((entry: { id: string }) => entry.id).sort());
    expect(manifest.images.filter((entry: { category: string }) => entry.category === "Coffee")).toHaveLength(4);
    expect(manifest.images.filter((entry: { category: string }) => entry.category === "Tea")).toHaveLength(3);
    expect(manifest.images.filter((entry: { category: string }) => entry.category === "Hot Drinks")).toHaveLength(2);
  });

  it("has complete immutable pending-review metadata", () => {
    expect(manifest.lifecycle).toBe("PENDING_REVIEW");
    for (const entry of manifest.images) {
      expect(entry).toMatchObject({ restaurant_type: "Cafe", provider: "openai-built-in-imagegen", provider_key: "openai-built-in-imagegen", version: 1, version_label: "v001", mime_type: "image/webp", width: 2048, height: 2048, lifecycle: "PENDING_REVIEW", lifecycle_history: ["GENERATING", "PENDING_REVIEW"], style_guide_id: "serveflow-food-photography-v1", style_guide_version: "1.0" });
      expect(Date.parse(entry.created_at)).not.toBeNaN();
      expect(entry.public_url).toBe(entry.responsive_variants[0].public_url);
      expect(entry.checksum_sha256).toBe(entry.responsive_variants[0].checksum_sha256);
    }
  });

  it("provides 54 immutable valid unique WebP variants", () => {
    const checksums = new Set<string>();
    const paths = new Set<string>();
    for (const entry of manifest.images) {
      expect(entry.responsive_variants.map((variant: { width: number }) => variant.width)).toEqual([2048, 1280, 1024, 768, 512, 320]);
      for (const variant of entry.responsive_variants) {
        const bytes = readFileSync(resolve(root, "public/smart-menu-images", variant.storage_path));
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(variant.checksum_sha256);
        expect(checksums.has(variant.checksum_sha256)).toBe(false);
        expect(paths.has(variant.storage_path)).toBe(false);
        checksums.add(variant.checksum_sha256);
        paths.add(variant.storage_path);
        expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
        expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
        expect(variant.mime_type).toBe("image/webp");
        expect(variant.height).toBe(variant.width);
        expect(variant.public_url).toMatch(/^https:\/\/[^/]+\/storage\/v1\/object\/public\/smart-menu-images\//);
        expect(variant.storage_path).toMatch(new RegExp(`^cafe\/(coffee|tea-hot-drinks)\/${entry.slug}\/v001\/${entry.slug}-v001-${variant.width}w\\.webp$`));
      }
    }
    expect(checksums.size).toBe(54);
    expect(paths.size).toBe(54);
  });
});
