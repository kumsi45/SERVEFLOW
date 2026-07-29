import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MASTER_ETHIOPIAN_IMAGE_NAMES, MASTER_ETHIOPIAN_IMAGES } from "../../src/modules/setup-wizard/data/masterEthiopianImageLibrary";
import { getMasterDishSpecification } from "../../src/modules/setup-wizard/data/masterDishSpecificationLibrary";

describe("Phase 9.13.4 Master Ethiopian Food Library", () => {
  it("contains only the ten approved unique dishes", () => {
    expect(MASTER_ETHIOPIAN_IMAGES).toHaveLength(10);
    expect(MASTER_ETHIOPIAN_IMAGES.map((image) => image.item_name)).toEqual(MASTER_ETHIOPIAN_IMAGE_NAMES);
    expect(new Set(MASTER_ETHIOPIAN_IMAGES.map((image) => image.checksum_sha256)).size).toBe(10);
  });

  it("uses the canonical specifications and pending-review metadata", () => {
    for (const image of MASTER_ETHIOPIAN_IMAGES) {
      const specification = getMasterDishSpecification(image.slug);
      expect(specification?.id).toBe(image.specification_id);
      expect(specification?.category).toBe("Traditional Ethiopian Dishes");
      expect(image.storage_path).toBe(`restaurant/ethiopian-traditional-dishes/${image.slug}/v001/${image.slug}-v001-2048w.webp`);
      expect(image).toMatchObject({ mime_type: "image/webp", width: 2048, height: 2048, version: 1, status: "PENDING_REVIEW", lifecycle: ["GENERATING", "PENDING_REVIEW"], active: true });
      expect(image.lifecycle).not.toContain("APPROVED");
    }
  });

  it("matches every WebP file to its recorded size and checksum", () => {
    for (const image of MASTER_ETHIOPIAN_IMAGES) {
      const path = resolve(process.cwd(), "public/smart-menu-images", image.storage_path);
      const bytes = readFileSync(path);
      expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
      expect(statSync(path).size).toBe(image.byte_size);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(image.checksum_sha256);
    }
  });
});
