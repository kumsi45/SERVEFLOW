import type { MenuItem } from "../types";

type FoodInfo = {
  description: string;
  ingredients: string[];
  allergens: string[];
  dietaryLabels: string[];
};

const DEFAULT_INFO: FoodInfo = {
  description: "Information coming soon.",
  ingredients: [],
  allergens: [],
  dietaryLabels: [],
};

const FOOD_INFO_RULES: Array<{
  keywords: string[];
  ingredients: string[];
  allergens: string[];
  dietaryLabels: string[];
}> = [
  {
    keywords: ["tibs", "beef"],
    ingredients: ["Beef", "Onion", "Rosemary", "Garlic", "Berbere Spice"],
    allergens: [],
    dietaryLabels: ["Spicy"],
  },
  {
    keywords: ["kitfo"],
    ingredients: ["Minced Beef", "Mitmita", "Clarified Butter", "Koseret"],
    allergens: ["Contains Dairy"],
    dietaryLabels: ["Spicy", "Contains Dairy"],
  },
  {
    keywords: ["beyaynetu", "shiro", "firfir", "injera"],
    ingredients: ["Injera", "Lentils", "Chickpeas", "Cabbage", "Berbere Spice"],
    allergens: ["Contains Gluten"],
    dietaryLabels: ["Vegetarian", "Vegan", "Contains Gluten"],
  },
  {
    keywords: ["macchiato", "coffee", "latte", "cappuccino"],
    ingredients: ["Coffee", "Milk"],
    allergens: ["Contains Dairy"],
    dietaryLabels: ["Contains Dairy"],
  },
  {
    keywords: ["cake", "pastry"],
    ingredients: ["Flour", "Eggs", "Sugar", "Butter"],
    allergens: ["Contains Dairy", "Contains Gluten", "Contains Eggs"],
    dietaryLabels: ["Contains Dairy", "Contains Gluten"],
  },
  {
    keywords: ["juice", "smoothie"],
    ingredients: ["Seasonal Fruit", "Water", "Sugar"],
    allergens: [],
    dietaryLabels: ["Vegetarian", "Vegan"],
  },
];

function findFoodInfoRule(name: string) {
  const normalizedName = name.toLowerCase();

  return FOOD_INFO_RULES.find((rule) =>
    rule.keywords.some((keyword) => normalizedName.includes(keyword))
  );
}

export function getFoodInfo(item: MenuItem): FoodInfo {
  const rule = findFoodInfoRule(item.name);

  return {
    description: item.description?.trim() || DEFAULT_INFO.description,
    ingredients: rule?.ingredients ?? DEFAULT_INFO.ingredients,
    allergens: rule?.allergens ?? DEFAULT_INFO.allergens,
    dietaryLabels: rule?.dietaryLabels ?? DEFAULT_INFO.dietaryLabels,
  };
}
