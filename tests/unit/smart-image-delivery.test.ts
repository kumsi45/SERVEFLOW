import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MenuItemImageInput } from "../../src/core/presentation/menuItemImage";
import {
  isSmartImageMemoryCached,
  createSmartImageOfflineDescriptor,
  markSmartImageCached,
  prefetchSmartImage,
  resolveSmartImage,
  SMART_IMAGE_TIERS,
  SMART_IMAGE_GENERATION_PLAN,
} from "../../src/core/presentation/smartImageDelivery";

const input: MenuItemImageInput = {
  itemId: "dish-1",
  custom: null,
  master: {
    source: "MASTER",
    status: "APPROVED",
    version: 1,
    url: "https://cdn.example/smart-menu-images/restaurant/burgers/beef-burger/v001/beef-burger-v001-2048w.webp",
  },
  placeholderUrl: "/menu-placeholder.svg",
};

describe("Phase 9.13.7A Smart Image Delivery Engine", () => {
  it("standardizes the permanent four delivery tiers", () => {
    expect(SMART_IMAGE_TIERS).toEqual({ thumbnail: 320, card: 512, detail: 1024, master: 2048 });
    expect(resolveSmartImage(input, "thumbnail").url).toContain("-320w.webp");
    expect(resolveSmartImage(input, "card").url).toContain("-512w.webp");
    expect(resolveSmartImage(input, "detail").url).toContain("-1024w.webp");
    expect(resolveSmartImage(input, "master").url).toContain("-2048w.webp");
  });

  it("makes the card available before remaining background variants", () => {
    expect(SMART_IMAGE_GENERATION_PLAN).toEqual({ blocking: ["master", "card"], displayAfter: "card", background: ["thumbnail", "detail"], validateAfterUpload: true });
  });

  it("never resolves a 2048 master for normal application usage", () => {
    for (const usage of ["thumbnail", "card", "detail"] as const) {
      const resolved = resolveSmartImage(input, usage);
      expect(resolved.url).not.toContain("-2048w.webp");
      expect(resolved.previewUrl).toContain("-320w.webp");
    }
  });

  it("keeps pending masters private from customers but visible in Review Studio", () => {
    const pending = { ...input, master: { ...input.master!, status: "PENDING_REVIEW" as const } };
    expect(resolveSmartImage(pending, "card", "customer").source).toBe("PLACEHOLDER");
    expect(resolveSmartImage(pending, "card", "owner-review").source).toBe("MASTER");
  });

  it("uses approved owner images before approved master images", () => {
    const resolved = resolveSmartImage({ ...input, custom: { source: "CUSTOM", status: "APPROVED", version: 4, url: "https://cdn.example/custom.webp" } }, "card");
    expect(resolved.source).toBe("CUSTOM");
    expect(resolved.version).toBe(4);
  });

  it("reuses the memory and browser HTTP caches when prefetching", async () => {
    const resolution = resolveSmartImage(input, "card");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("image", { status: 200 }));
    await prefetchSmartImage(resolution);
    await prefetchSmartImage(resolution);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(resolution.url, expect.objectContaining({ cache: "force-cache", priority: "low" }));
    expect(isSmartImageMemoryCached(resolution.url)).toBe(true);
    fetchMock.mockRestore();
  });

  it("exposes cache state for already rendered immutable images", () => {
    const url = "https://cdn.example/image-v9-512w.webp";
    markSmartImageCached(url);
    expect(isSmartImageMemoryCached(url)).toBe(true);
  });

  it("provides a stable immutable descriptor for a future offline worker", () => {
    expect(createSmartImageOfflineDescriptor(resolveSmartImage(input, "card"))).toMatchObject({ width: 512, version: 1, immutable: true });
  });

  it("keeps lazy loading, progressive loading, retry and failure reporting centralized", () => {
    const component = readFileSync(resolve(process.cwd(), "src/core/presentation/SmartImage.tsx"), "utf8");
    expect(component).toContain("IntersectionObserver");
    expect(component).toContain("smart-image-skeleton");
    expect(component).toContain("smart-image-preview");
    expect(component).toContain("attempt === 0");
    expect(component).toContain("reportSmartImageFailure");
  });

  it("virtualizes large menu cards with Intersection Observer instead of page scroll handlers", () => {
    const virtualizer = readFileSync(resolve(process.cwd(), "src/core/presentation/VirtualizedCard.tsx"), "utf8");
    expect(virtualizer).toContain("IntersectionObserver");
    expect(virtualizer).toContain("nearViewport ? children() : null");
    expect(virtualizer).not.toContain("onScroll");
    for (const file of ["modern/ModernFoodView.tsx", "luxury/PremiumLuxuryView.tsx", "premium-grid/PremiumGridView.tsx", "coffee/CoffeeThemeView.tsx"]) {
      expect(readFileSync(resolve(process.cwd(), "src/modules/menu/theme-engine/themes", file), "utf8"), file).toContain("VirtualizedCard");
    }
  });

  it("prefetches nearby QR menu images only through the shared idle prefetch hook", () => {
    const qrMenu = readFileSync(resolve(process.cwd(), "src/modules/qr-menu/pages/QRMenuPage.tsx"), "utf8");
    const hook = readFileSync(resolve(process.cwd(), "src/core/presentation/useSmartImagePrefetch.ts"), "utf8");
    expect(qrMenu).toContain("useSmartImagePrefetch");
    expect(qrMenu).not.toMatch(/new Image\(|\.src\s*=/);
    expect(hook).toContain("prefetchSmartImages");
  });
});
