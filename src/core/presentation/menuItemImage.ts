export type MenuImageLifecycle = "PLACEHOLDER" | "GENERATING" | "PENDING_REVIEW" | "APPROVED" | "ARCHIVED";
export type MenuImageSource = "CUSTOM" | "MASTER" | "PLACEHOLDER";
export type MenuImageAudience = "customer" | "owner-review";

export type MenuImageCandidate = {
  id?: string;
  source: MenuImageSource;
  status: MenuImageLifecycle;
  url: string | null;
  thumbnailUrl?: string | null;
  version: number;
  storagePath?: string | null;
  width?: number | null;
  height?: number | null;
  mimeType?: string | null;
  checksumSha256?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type MenuItemImageInput = {
  itemId: string;
  custom?: MenuImageCandidate | null;
  master?: MenuImageCandidate | null;
  placeholderUrl: string;
};

export type PublishedMenuImageFields = {
  id: string;
  image_url?: string | null;
  effective_image_url?: string | null;
  custom_image?: MenuImageCandidate | null;
  master_image?: MenuImageCandidate | null;
};

/** Adapts the published API shape without deciding image priority or visibility. */
export function publishedMenuImageInput(item: PublishedMenuImageFields): MenuItemImageInput {
  return {
    itemId: item.id,
    custom: item.custom_image ?? null,
    master: item.master_image ?? (item.image_url ? {
      source: "MASTER",
      status: "APPROVED",
      url: item.image_url,
      thumbnailUrl: item.image_url,
      version: 1,
    } : null),
    placeholderUrl: item.effective_image_url && item.effective_image_url !== item.image_url
      ? item.effective_image_url
      : "",
  };
}

const OWNER_MASTER_STATES = new Set<MenuImageLifecycle>(["GENERATING", "PENDING_REVIEW", "APPROVED"]);

/** The only authority for CUSTOM > MASTER > PLACEHOLDER and audience visibility. */
export function resolveMenuItemImage(
  input: MenuItemImageInput,
  audience: MenuImageAudience = "customer",
): MenuImageCandidate {
  const { itemId, custom, master, placeholderUrl } = input;
  if (custom?.status === "APPROVED" && custom.url) return { ...custom, source: "CUSTOM" };

  const masterVisible = master && (audience === "owner-review"
    ? OWNER_MASTER_STATES.has(master.status)
    : master.status === "APPROVED");
  if (masterVisible) {
    if (master.url) return { ...master, source: "MASTER" };
    console.error("Missing image resolution", { itemId });
  }

  return {
    source: "PLACEHOLDER",
    status: "PLACEHOLDER",
    url: placeholderUrl,
    thumbnailUrl: placeholderUrl,
    version: 0,
  };
}
