import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MASTER_BREAKFAST_IMAGE_NAMES,
  MASTER_BREAKFAST_IMAGES,
} from "../../src/modules/setup-wizard/data/masterBreakfastImageLibrary";
import { getMasterDishSpecification } from "../../src/modules/setup-wizard/data/masterDishSpecificationLibrary";

const imageRoot = resolve(process.cwd(), "public/smart-menu-images");

describe("Phase 9.13.3 Master Breakfast Image Library", () => {
  it("contains exactly the eight approved breakfast dishes", () => {
    expect(MASTER_BREAKFAST_IMAGES).toHaveLength(8);
    expect(MASTER_BREAKFAST_IMAGES.map((image) => image.item_name)).toEqual(MASTER_BREAKFAST_IMAGE_NAMES);
    expect(new Set(MASTER_BREAKFAST_IMAGES.map((image) => image.slug)).size).toBe(8);
  });

  it("uses deterministic immutable WebP filenames and pending-review lifecycle", () => {
    for (const image of MASTER_BREAKFAST_IMAGES) {
      expect(image.filename).toBe(`${image.slug}-v001-2048w.webp`);
      expect(image.storage_path).toBe(`restaurant/breakfast/${image.slug}/v001/${image.filename}`);
      expect(image).toMatchObject({
        mime_type: "image/webp",
        width: 2048,
        height: 2048,
        version: 1,
        status: "PENDING_REVIEW",
        lifecycle: ["GENERATING", "PENDING_REVIEW"],
        active: true,
      });
      expect(image.lifecycle).not.toContain("APPROVED");
    }
  });

  it("matches every asset to its Breakfast master dish specification", () => {
    for (const image of MASTER_BREAKFAST_IMAGES) {
      const specification = getMasterDishSpecification(image.slug);
      expect(specification).not.toBeNull();
      expect(specification?.id).toBe(image.specification_id);
      expect(specification?.category).toBe("Breakfast");
    }
  });

  it("ships eight distinct files whose bytes match their metadata", () => {
    const checksums = new Set<string>();
    for (const image of MASTER_BREAKFAST_IMAGES) {
      const path = resolve(imageRoot, image.storage_path);
      expect(existsSync(path)).toBe(true);
      const bytes = readFileSync(path);
      expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
      expect(statSync(path).size).toBe(image.byte_size);
      const checksum = createHash("sha256").update(bytes).digest("hex");
      expect(checksum).toBe(image.checksum_sha256);
      checksums.add(checksum);
    }
    expect(checksums.size).toBe(8);
  });
});
