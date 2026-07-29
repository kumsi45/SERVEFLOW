import document from "./masterEthiopianImageLibrary.v1.json";

export const MASTER_ETHIOPIAN_IMAGE_NAMES = ["Kitfo", "Tibs", "Shekla Tibs", "Doro Wot", "Key Wot", "Gored Gored", "Shiro", "Misir Wot", "Beyaynetu", "Tegabino"] as const;

export type MasterEthiopianImage = {
  item_name: (typeof MASTER_ETHIOPIAN_IMAGE_NAMES)[number]; slug: string; specification_id: string;
  style_guide_id: string; style_guide_version: string; storage_path: string; filename: string;
  mime_type: "image/webp"; width: 2048; height: 2048; byte_size: number; checksum_sha256: string;
  version: 1; status: "PENDING_REVIEW"; lifecycle: ["GENERATING", "PENDING_REVIEW"];
  provider_key: string; active: true;
};

export const MASTER_ETHIOPIAN_IMAGES = Object.freeze(document.images as MasterEthiopianImage[]);
