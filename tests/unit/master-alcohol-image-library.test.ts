import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const manifest = JSON.parse(readFileSync(resolve(root, "src/modules/setup-wizard/data/masterAlcoholImageLibrary.v1.json"), "utf8"));
const specs = JSON.parse(readFileSync(resolve(root, "src/modules/setup-wizard/data/masterDishSpecifications.v1.json"), "utf8")).specifications;
const categories = ["Beer", "Wine", "Whisky", "Cocktails", "Mocktails"];
const approved = specs.filter((entry: { active: boolean; category: string }) => entry.active && categories.includes(entry.category));

describe("Phase 9.13.11 Alcohol master images", () => {
  it("contains exactly every active approved beverage", () => {
    expect(manifest.phase).toBe("9.13.11");
    expect(manifest.categories).toEqual(categories);
    expect(manifest.images.map((entry: { dish_id: string }) => entry.dish_id).sort()).toEqual(approved.map((entry: { id: string }) => entry.id).sort());
    expect(manifest.images.filter((entry: { category: string }) => entry.category === "Beer")).toHaveLength(3);
    expect(manifest.images.filter((entry: { category: string }) => entry.category === "Wine")).toHaveLength(3);
    expect(manifest.images.filter((entry: { category: string }) => entry.category === "Whisky")).toHaveLength(3);
    expect(manifest.images.filter((entry: { category: string }) => entry.category === "Cocktails")).toHaveLength(5);
    expect(manifest.images.filter((entry: { category: string }) => entry.category === "Mocktails")).toHaveLength(3);
  });

  it("has complete immutable pending-review metadata", () => {
    expect(manifest.lifecycle).toBe("PENDING_REVIEW");
    for (const entry of manifest.images) {
      expect(entry).toMatchObject({ restaurant_type: "Bar & Lounge", provider: "openai-built-in-imagegen", provider_key: "openai-built-in-imagegen", version: 1, version_label: "v001", mime_type: "image/webp", width: 2048, height: 2048, lifecycle: "PENDING_REVIEW", lifecycle_history: ["GENERATING", "PENDING_REVIEW"], style_guide_id: "serveflow-food-photography-v1", style_guide_version: "1.0" });
      expect(Date.parse(entry.created_at)).not.toBeNaN();
      expect(entry.public_url).toBe(entry.responsive_variants[0].public_url);
      expect(entry.checksum_sha256).toBe(entry.responsive_variants[0].checksum_sha256);
    }
  });

  it("provides 102 immutable valid unique WebP variants", () => {
    const checksums = new Set<string>();
    const paths = new Set<string>();
    for (const entry of manifest.images) {
      expect(entry.responsive_variants.map((variant: { width: number }) => variant.width)).toEqual([2048, 1280, 1024, 768, 512, 320]);
      expect(entry.base_storage_path).toMatch(/^bar-lounge\/(alcoholic-drinks|fresh-juice)\/[a-z0-9-]+$/);
      for (const variant of entry.responsive_variants) {
        const bytes = readFileSync(resolve(root, "public/smart-menu-images", variant.storage_path));
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(variant.checksum_sha256);
        expect(checksums.has(variant.checksum_sha256)).toBe(false);
        expect(paths.has(variant.storage_path)).toBe(false);
        checksums.add(variant.checksum_sha256); paths.add(variant.storage_path);
        expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
        expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
        expect(variant).toMatchObject({ mime_type: "image/webp", height: variant.width });
        expect(variant.public_url).toMatch(/^https:\/\/[^/]+\/storage\/v1\/object\/public\/smart-menu-images\//);
        expect(variant.storage_path).toBe(`${entry.base_storage_path}/v001/${entry.slug}-v001-${variant.width}w.webp`);
      }
    }
    expect(checksums.size).toBe(102); expect(paths.size).toBe(102);
  });
});
