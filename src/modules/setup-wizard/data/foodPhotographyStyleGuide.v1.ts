import type { MasterDishSpecification } from "./masterDishSpecificationLibrary";

export const SERVEFLOW_FOOD_PHOTOGRAPHY_STYLE_GUIDE_V1 = Object.freeze({
  id: "serveflow-food-photography-v1",
  version: "1.0",
  status: "FROZEN",
  identity: ["Professional restaurant food photography", "Luxury cafe photography", "Natural", "Modern", "Premium", "Minimal", "Authentic"],
  background: { primary: "White marble", alternative: "Light gray matte", prohibited: ["Dark background", "Wood table", "Patterned tablecloth", "Messy background", "Kitchen background", "Restaurant interiors", "People"] },
  plate: { default: "Modern premium white ceramic", rules: ["No logos", "No branding", "No decorative patterns", "No colored plates unless culturally required"] },
  lighting: { required: ["Soft daylight", "Balanced exposure", "Natural shadows"], prohibited: ["Dramatic lighting", "Colored lighting", "HDR exaggeration", "Artificial glow"] },
  camera: { allowed: ["Top-down", "45°", "Front"], topDown: ["Pizza", "Salads", "Breakfast platters"], fortyFive: ["Burger", "Coffee", "Cake", "Soup", "Pasta", "Plated Ethiopian dishes"], front: ["Bread", "Bakery", "Drinks when vessel profile is important"] },
  composition: ["One dish only", "Centered", "Clean spacing", "Entire plate or vessel visible", "No cropped food", "No multiple meals", "No duplicate servings"],
  food: ["Authentic appearance", "Correct ingredients", "Correct texture", "Correct cooking level", "Correct cultural presentation", "Realistic portion size", "Restaurant serving quality"],
  color: ["Natural", "Warm but realistic", "Consistent white balance", "No oversaturation", "No fake contrast"],
  master: { width: 2048, height: 2048, aspectRatio: "1:1", format: "WEBP" },
  derivatives: [1280, 1024, 768, 512, 320],
  globalNegativePrompt: "No text, no watermark, no logo, no human hands, no people, no forks, no knives, no phones, no extra plates, no messy table, no dark background, no wood table, no patterned tablecloth, no restaurant interior, no kitchen background, no artificial colors, no oversaturation, no fake contrast, no HDR exaggeration, no artificial glow, no AI artifacts, no floating ingredients, no duplicate food, no multiple meals, no cropped food, no random herbs, no flowers, no unrealistic decoration, no cartoon appearance, no painting style, no illustration.",
  categoryExceptions: {
    ethiopian: "Correct injera, traditional plating, authentic bowls, ingredients, and accompaniments.",
    coffee: "Appropriate modern or traditional cup and natural foam where applicable.",
    western: "Modern premium restaurant presentation on white ceramic.",
    bakery: "Clean bakery-display presentation with the global background and lighting.",
    bar: "Professional beverage glassware and realistic liquid color without people or venue background.",
  },
} as const);

export function composeServeFlowPhotographyBrief(specification: MasterDishSpecification) {
  const guide = SERVEFLOW_FOOD_PHOTOGRAPHY_STYLE_GUIDE_V1;
  return Object.freeze({
    styleGuideId: guide.id,
    styleGuideVersion: guide.version,
    specificationId: specification.id,
    itemName: specification.item_name,
    cameraAngle: specification.camera_angle,
    visualDirection: `${specification.visual_description} Use ${guide.background.primary} or ${guide.background.alternative}, ${guide.lighting.required.join(", ").toLocaleLowerCase()}, one centered complete serving, and consistent natural color.`,
    negativePrompt: `${specification.negative_prompt} ${guide.globalNegativePrompt}`,
    master: guide.master,
    derivatives: guide.derivatives,
  });
}
