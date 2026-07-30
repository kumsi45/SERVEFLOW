import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/201_phase9_12_2_6_master_description_library.sql"), "utf8");
const match = migration.match(/\$descriptions\$\s*([\s\S]*?)\s*\$descriptions\$::jsonb/);
if (!match) throw new Error("Master description JSON was not found in migration 201.");
const descriptions = JSON.parse(match[1]) as Record<string, string>;
const values = Object.values(descriptions);

describe("Phase 9.12.2.6 Master Description Library", () => {
  it("contains exactly 180 one-to-one descriptions", () => {
    expect(Object.keys(descriptions)).toHaveLength(180);
    expect(new Set(Object.keys(descriptions)).size).toBe(180);
    expect(values).toHaveLength(180);
  });

  it("keeps every description unique and within 160 characters", () => {
    expect(new Set(values.map((value) => value.trim().toLowerCase())).size).toBe(180);
    for (const value of values) {
      expect(value).toBe(value.trim());
      expect(value.length).toBeGreaterThan(0);
      expect(value.length).toBeLessThanOrEqual(160);
    }
  });

  it("contains no placeholders, lorem ipsum, or banned marketing words", () => {
    const forbidden = /lorem ipsum|carefully prepared|satisfying dining experience|refreshing drink|\bamazing\b|\bfantastic\b|\bbest\b|\bdelicious\b|\bwonderful\b/i;
    for (const value of values) expect(value).not.toMatch(forbidden);
  });

  it("updates only default_description and validates exact hosted names", () => {
    expect(migration).toContain("set default_description = descriptions->>item.name");
    expect(migration).toContain("authored description names do not exactly match");
    expect(migration).not.toMatch(/set\s+(category_id|name|default_image_reference|display_order|keywords|active)\s*=/i);
  });
});
