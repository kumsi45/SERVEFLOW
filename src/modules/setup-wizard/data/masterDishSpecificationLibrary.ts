import document from "./masterDishSpecifications.v1.json";

export const MASTER_DISH_CAMERA_ANGLES = ["Top-down", "45°", "Front"] as const;
export const MASTER_DISH_IMAGE_STATUSES = ["PLACEHOLDER", "GENERATING", "PENDING_REVIEW", "APPROVED", "ARCHIVED"] as const;

export type MasterDishSpecification = {
  id: string;
  item_name: string;
  slug: string;
  category: string;
  business_types_using_this_item: string[];
  food_origin: string;
  dish_type: string;
  serving_style: string;
  plate_style: string;
  camera_angle: typeof MASTER_DISH_CAMERA_ANGLES[number];
  composition: string;
  background: string;
  lighting: string;
  garnish: string;
  ingredients_summary: string;
  visual_description: string;
  negative_prompt: string;
  image_status: typeof MASTER_DISH_IMAGE_STATUSES[number];
  version: number;
  active: boolean;
};

export const MASTER_DISH_SPECIFICATION_VERSION = document.version;
export const MASTER_DISH_SPECIFICATIONS = Object.freeze(document.specifications as MasterDishSpecification[]);
export const MASTER_DISH_SPECIFICATION_BY_SLUG = new Map(MASTER_DISH_SPECIFICATIONS.map((specification) => [specification.slug, specification]));

export function getMasterDishSpecification(slug: string) {
  return MASTER_DISH_SPECIFICATION_BY_SLUG.get(slug) ?? null;
}
