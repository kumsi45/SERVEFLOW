import document from "./masterBreakfastImageLibrary.v1.json";

export const MASTER_BREAKFAST_IMAGE_NAMES = [
  "Chechebsa",
  "Firfir",
  "Ful",
  "Fetira",
  "Omelette",
  "Scrambled Eggs",
  "Kinche",
  "Dulet",
] as const;

export type MasterBreakfastImage = {
  item_name: (typeof MASTER_BREAKFAST_IMAGE_NAMES)[number];
  slug: string;
  specification_id: string;
  style_guide_id: string;
  style_guide_version: string;
  storage_path: string;
  filename: string;
  mime_type: "image/webp";
  width: 2048;
  height: 2048;
  byte_size: number;
  checksum_sha256: string;
  version: 1;
  status: "PENDING_REVIEW";
  lifecycle: ["GENERATING", "PENDING_REVIEW"];
  provider_key: string;
  active: true;
};

export const MASTER_BREAKFAST_IMAGE_LIBRARY_VERSION = document.version;
export const MASTER_BREAKFAST_IMAGES = Object.freeze(document.images as MasterBreakfastImage[]);
export const MASTER_BREAKFAST_IMAGE_BY_SLUG = new Map(
  MASTER_BREAKFAST_IMAGES.map((image) => [image.slug, image]),
);
