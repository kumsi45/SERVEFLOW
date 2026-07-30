import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildResponsiveImageSet, buildSmartImageBasePath, buildSmartImageVersionPath, SMART_MENU_IMAGE_CACHE_CONTROL } from "../../src/modules/setup-wizard/services/smartImageLibrary";
import { resolveMenuItemImage } from "../../src/core/presentation/menuItemImage";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/200_phase9_13_1_global_smart_image_library.sql"), "utf8");
const imageComponent = readFileSync(resolve(process.cwd(), "src/modules/setup-wizard/components/SmartMenuImage.tsx"), "utf8");
const overrideService = readFileSync(resolve(process.cwd(), "src/modules/setup-wizard/services/smartImageOverrideService.ts"), "utf8");

describe("Phase 9.13.1 global Smart Image Library foundation", () => {
  it("creates one public CDN-ready bucket without client write access", () => {
    expect(migration).toContain("'smart-menu-images'");
    expect(migration).toContain("smart_menu_images_public_read");
    expect(migration).toContain("There is intentionally no client write policy");
    expect(migration).toContain("image/avif");
  });

  it("models the complete lifecycle, immutable versions, and owner sources", () => {
    for (const status of ["PLACEHOLDER", "GENERATING", "PENDING_REVIEW", "APPROVED", "ARCHIVED"]) expect(migration).toContain(status);
    for (const source of ["MASTER", "CUSTOM", "PLACEHOLDER"]) expect(migration).toContain(source);
    expect(migration).toContain("serveflow_smart_menu_images");
    expect(migration).toContain("serveflow_smart_menu_image_versions");
    expect(migration).toContain("restaurant_smart_menu_image_overrides");
    expect(migration).toContain("provider_metadata jsonb");
  });

  it("builds deterministic restaurant/category/item version paths", () => {
    const base = buildSmartImageBasePath("bar-lounge", "Bar Snacks", "Chicken Wings");
    expect(base).toBe("bar-lounge/bar-snacks/chicken-wings");
    expect(buildSmartImageVersionPath(base, "Chicken Wings", 3, 640)).toBe("bar-lounge/bar-snacks/chicken-wings/v003/chicken-wings-v003-640w.webp");
    expect(buildResponsiveImageSet("https://cdn.example", base, "Chicken Wings", 3).split(", ")).toHaveLength(5);
    expect(SMART_MENU_IMAGE_CACHE_CONTROL).toContain("immutable");
  });

  it("resolves custom, master, placeholder, and Restore Default deterministically", () => {
    const master = { source: "MASTER", status: "APPROVED", url: "master.webp", version: 2 } as const;
    const custom = { source: "CUSTOM", status: "APPROVED", url: "custom.webp", version: 1 } as const;
    expect(resolveMenuItemImage({ itemId: "item", master, custom, placeholderUrl: "placeholder.webp" }).url).toBe("custom.webp");
    expect(resolveMenuItemImage({ itemId: "item", master, placeholderUrl: "placeholder.webp" }).url).toBe("master.webp");
    expect(resolveMenuItemImage({ itemId: "item", placeholderUrl: "placeholder.webp" }).source).toBe("PLACEHOLDER");
    expect(overrideService).toContain("setCustomSmartImageOverride");
    expect(overrideService).toContain("restoreDefaultSmartImage");
    expect(overrideService).toContain('source: "MASTER"');
    expect(overrideService).toContain("custom_image_url: null");
  });

  it("provides lazy, responsive, low-priority image rendering", () => {
    expect(imageComponent).toContain('loading="lazy"');
    expect(imageComponent).toContain('decoding="async"');
    expect(imageComponent).toContain('fetchPriority="low"');
    expect(imageComponent).toContain("srcSet={srcSet}");
    expect(imageComponent).toContain("sizes={srcSet ? sizes : undefined}");
  });

  it("does not contain image generation or provider API calls", () => {
    expect(migration).not.toMatch(/openai|gemini|claude|api\.openai|fetch\(/i);
  });
});
