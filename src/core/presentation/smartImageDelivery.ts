import type { MenuImageAudience, MenuImageCandidate, MenuItemImageInput } from "./menuItemImage";
import { resolveMenuItemImage } from "./menuItemImage";

export const SMART_IMAGE_TIERS = {
  thumbnail: 320,
  card: 512,
  detail: 1024,
  master: 2048,
} as const;

export type SmartImageTier = keyof typeof SMART_IMAGE_TIERS;
export type SmartImageUsage = "thumbnail" | "card" | "detail" | "master";

export type SmartImageResolution = {
  itemId: string;
  source: MenuImageCandidate["source"];
  lifecycle: MenuImageCandidate["status"];
  version: number;
  tier: SmartImageTier;
  width: number;
  url: string | null;
  previewUrl: string | null;
  placeholderUrl: string | null;
  cacheKey: string;
  storagePath: string | null;
};

export type SmartImageGenerationPlan = {
  blocking: readonly ["master", "card"];
  displayAfter: "card";
  background: readonly ["thumbnail", "detail"];
  validateAfterUpload: true;
};

export const SMART_IMAGE_GENERATION_PLAN: SmartImageGenerationPlan = {
  blocking: ["master", "card"],
  displayAfter: "card",
  background: ["thumbnail", "detail"],
  validateAfterUpload: true,
};

export type SmartImageOfflineDescriptor = Pick<SmartImageResolution, "cacheKey" | "url" | "width" | "version" | "storagePath"> & {
  immutable: true;
};

const memoryCache = new Set<string>();
const inflightPrefetches = new Map<string, Promise<void>>();
const VERSIONED_VARIANT = /^(.*\/v\d+\/[^/]+-v\d+-)(?:320|512|768|1024|1280|2048)(w\.(?:webp|avif))([?#].*)?$/i;

function replaceVariantWidth(url: string, width: number) {
  return VERSIONED_VARIANT.test(url)
    ? url.replace(VERSIONED_VARIANT, `$1${width}$2$3`)
    : url;
}

export function createSmartImagePublicUrl(bucket: string, storagePath: string) {
  const baseUrl = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
  if (!baseUrl) throw new Error("Smart image CDN URL is unavailable.");
  const encodedPath = storagePath.split("/").map(encodeURIComponent).join("/");
  return `${baseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodedPath}`;
}

function candidateUrl(candidate: MenuImageCandidate, width: number) {
  const responsive = candidate.metadata?.responsiveVariants;
  if (Array.isArray(responsive)) {
    const exact = responsive.find((entry) => {
      if (!entry || typeof entry !== "object") return false;
      return Number((entry as { width?: unknown }).width) === width;
    }) as { publicUrl?: unknown; public_url?: unknown; url?: unknown } | undefined;
    const value = exact?.publicUrl ?? exact?.public_url ?? exact?.url;
    if (typeof value === "string" && value) return value;
  }
  return candidate.url;
}

export function resolveSmartImage(
  input: MenuItemImageInput,
  usage: SmartImageUsage = "card",
  audience: MenuImageAudience = "customer",
): SmartImageResolution {
  const candidate = resolveMenuItemImage(input, audience);
  const width = SMART_IMAGE_TIERS[usage];
  const url = candidateUrl(candidate, width);
  const previewUrl = candidateUrl(candidate, SMART_IMAGE_TIERS.thumbnail) ?? candidate.thumbnailUrl ?? url;
  const placeholderUrl = candidate.thumbnailUrl ?? previewUrl ?? input.placeholderUrl ?? null;
  return {
    itemId: input.itemId,
    source: candidate.source,
    lifecycle: candidate.status,
    version: candidate.version,
    tier: usage,
    width,
    url,
    previewUrl,
    placeholderUrl,
    cacheKey: `${input.itemId}:${candidate.source}:v${candidate.version}:${width}:${url ?? "fallback"}`,
    storagePath: candidate.storagePath && url !== candidate.url
      ? replaceVariantWidth(candidate.storagePath, width)
      : candidate.storagePath ?? null,
  };
}

export function markSmartImageCached(url: string) {
  memoryCache.add(url);
}

export function isSmartImageMemoryCached(url: string | null | undefined) {
  return Boolean(url && memoryCache.has(url));
}

export function prefetchSmartImage(resolution: SmartImageResolution) {
  const url = resolution.url;
  if (!url || memoryCache.has(url)) return Promise.resolve();
  const existing = inflightPrefetches.get(url);
  if (existing) return existing;
  const request = fetch(url, { cache: "force-cache", priority: "low" })
    .then((response) => {
      if (!response.ok) throw new Error(`Smart image prefetch failed (${response.status})`);
      memoryCache.add(url);
    })
    .catch((error: unknown) => {
      console.warn("Smart image prefetch failed", { itemId: resolution.itemId, url, error });
    })
    .finally(() => inflightPrefetches.delete(url));
  inflightPrefetches.set(url, request);
  return request;
}

export function prefetchSmartImages(resolutions: SmartImageResolution[]) {
  const schedule = () => void Promise.all(resolutions.map(prefetchSmartImage));
  if (typeof window !== "undefined" && window.requestIdleCallback) {
    window.requestIdleCallback(schedule, { timeout: 1500 });
  } else if (typeof window !== "undefined") {
    window.setTimeout(schedule, 0);
  }
}

export function reportSmartImageFailure(resolution: SmartImageResolution, error?: unknown) {
  console.error("Smart image resolution failure", {
    itemId: resolution.itemId,
    source: resolution.source,
    lifecycle: resolution.lifecycle,
    tier: resolution.tier,
    url: resolution.url,
    error,
  });
}

/** Stable hand-off contract for a future offline worker; it performs no download or persistence. */
export function createSmartImageOfflineDescriptor(resolution: SmartImageResolution): SmartImageOfflineDescriptor {
  return {
    cacheKey: resolution.cacheKey,
    url: resolution.url,
    width: resolution.width,
    version: resolution.version,
    storagePath: resolution.storagePath,
    immutable: true,
  };
}
