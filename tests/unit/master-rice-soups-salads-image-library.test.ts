import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const manifest = JSON.parse(readFileSync(resolve(root, "src/modules/setup-wizard/data/masterRiceSoupsSaladsImageLibrary.v1.json"), "utf8"));
const specs = JSON.parse(readFileSync(resolve(root, "src/modules/setup-wizard/data/masterDishSpecifications.v1.json"), "utf8")).specifications;
const approved = specs.filter((entry: { active: boolean; category: string }) => entry.active && ["Rice Dishes", "Soups", "Salads"].includes(entry.category));

describe("Phase 9.13.8 Rice Soups Salads master images", () => {
  it("contains exactly every active approved dish", () => {
    expect(manifest.phase).toBe("9.13.8");
    expect(manifest.categories).toEqual(["Rice Dishes", "Soups", "Salads"]);
    expect(manifest.images.map((entry: { dish_id: string }) => entry.dish_id).sort()).toEqual(approved.map((entry: { id: string }) => entry.id).sort());
    expect(manifest.images.filter((entry: { category: string }) => entry.category === "Rice Dishes")).toHaveLength(4);
    expect(manifest.images.filter((entry: { category: string }) => entry.category === "Soups")).toHaveLength(5);
    expect(manifest.images.filter((entry: { category: string }) => entry.category === "Salads")).toHaveLength(7);
  });

  it("has complete immutable pending-review metadata", () => {
    expect(manifest.lifecycle).toBe("PENDING_REVIEW");
    for (const entry of manifest.images) {
      expect(entry).toMatchObject({ provider: "openai-built-in-imagegen", provider_key: "openai-built-in-imagegen", version: 1, version_label: "v001", mime_type: "image/webp", width: 2048, height: 2048, lifecycle: "PENDING_REVIEW", lifecycle_history: ["GENERATING", "PENDING_REVIEW"] });
      expect(Date.parse(entry.created_at)).not.toBeNaN();
      expect(entry.public_url).toBe(entry.responsive_variants[0].public_url);
      expect(entry.checksum_sha256).toBe(entry.responsive_variants[0].checksum_sha256);
    }
  });

  it("provides 96 immutable valid unique WebP variants", () => {
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
        expect(variant.mime_type).toBe("image/webp");
        expect(variant.height).toBe(variant.width);
        expect(variant.public_url).toMatch(/^https:\/\/[^/]+\/storage\/v1\/object\/public\/smart-menu-images\//);
        expect(variant.storage_path).toMatch(new RegExp(`^(restaurant|hotel)/(rice-dishes|soups|salads)/${entry.slug}/v001/${entry.slug}-v001-${variant.width}w\\.webp$`));
      }
    }
    expect(checksums.size).toBe(96);
  });
});
