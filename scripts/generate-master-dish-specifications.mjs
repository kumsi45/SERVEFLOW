import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const migration = readFileSync(resolve(root, "supabase/migrations/199_phase9_12_2_master_menu_library.sql"), "utf8");
const match = migration.match(/specification jsonb := \$library\$\s*([\s\S]*?)\s*\$library\$/);
if (!match) throw new Error("Approved Phase 9.12.2 specification was not found.");
const templates = JSON.parse(match[1]);

const ETHIOPIAN = {
  Chechebsa: "torn flatbread coated with spiced clarified butter and berbere",
  Firfir: "torn injera mixed with berbere sauce and traditional Ethiopian seasoning",
  Ful: "slow-cooked fava beans with traditional savory accompaniments",
  Fetira: "layered pan-cooked Ethiopian flatbread with a lightly crisp exterior",
  Kinche: "cracked wheat cooked until tender with traditional Ethiopian seasoning",
  Dulet: "finely chopped traditional Ethiopian meat preparation with aromatic spices",
  Kitfo: "finely minced beef seasoned with mitmita and spiced clarified butter",
  Tibs: "sautéed meat prepared in the traditional Ethiopian style with aromatic seasoning",
  "Shekla Tibs": "sizzling Ethiopian-style sautéed meat served in a traditional clay vessel",
  "Doro Wot": "slow-cooked Ethiopian chicken stew with berbere, onion, and traditional seasoning",
  "Key Wot": "rich Ethiopian red stew built on onion, berbere, and traditional spices",
  "Gored Gored": "cubed beef seasoned in the traditional Ethiopian style with clarified butter and spices",
  Shiro: "smooth Ethiopian chickpea stew seasoned with onion and traditional spices",
  "Misir Wot": "Ethiopian red lentil stew with berbere, onion, and traditional seasoning",
  Beyaynetu: "assorted Ethiopian vegetable and pulse dishes arranged together on injera",
  Tegabino: "thick, richly seasoned Ethiopian chickpea preparation served hot",
  "Asa Tibs": "Ethiopian-style seasoned fish pieces cooked until golden and tender",
  "Ethiopian Breakfast": "a balanced selection of recognizable Ethiopian breakfast dishes",
};

const ORIGINS = [
  [/Chechebsa|Firfir|Ful|Fetira|Kinche|Dulet|Kitfo|Tibs|Doro Wot|Key Wot|Gored Gored|Shiro|Misir Wot|Beyaynetu|Tegabino|Asa Tibs|Ethiopian Breakfast/i, "Ethiopia"],
  [/Pizza|Spaghetti|Pasta|Macaroni|Espresso|Macchiato|Latte|Cappuccino|Americano|Mocha/i, "Italy"],
  [/Croissant|Danish Pastry|French Bread/i, "France"],
  [/Burger|Hot Dog|Brownie|Cupcake|Chocolate Chip Cookie/i, "United States"],
  [/Greek Salad/i, "Greece"], [/Mojito/i, "Cuba"], [/Margarita/i, "Mexico"],
];

const all = new Map();
for (const template of templates) {
  for (const section of template.sections) {
    for (const name of section.items) {
      const existing = all.get(name) ?? { item_name: name, category: section.name, businessTypes: new Set() };
      existing.businessTypes.add(template.type);
      all.set(name, existing);
    }
  }
}

function slug(value) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function stableId(name) {
  const hex = createHash("sha256").update(`serveflow-master-dish-v1:${name}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function camera(category, name) {
  if (/Pizza|Salad|Rice|Fries|Breakfast|Beyaynetu/i.test(`${category} ${name}`)) return "Top-down";
  if (/Bread$|Baguette|Toast/i.test(name)) return "Front";
  return "45°";
}

function dishType(category, name) {
  if (/Coffee|Tea|Juice|Drink|Beer|Wine|Whisky|Cocktail|Mocktail|Milkshake|Water|Coca-Cola|Pepsi|Sprite|Fanta|Milk$/i.test(`${category} ${name}`)) return "Beverage";
  if (/Cake|Dessert|Donut|Cupcake|Cookie|Brownie|Ice Cream|Sundae|Fruit Salad|Pie$/i.test(`${category} ${name}`)) return "Dessert";
  if (/Bread|Pastr|Croissant|Muffin/i.test(`${category} ${name}`)) return "Baked good";
  if (/Soup/i.test(`${category} ${name}`)) return "Soup";
  return "Prepared dish";
}

function ingredients(name, category) {
  if (ETHIOPIAN[name]) return ETHIOPIAN[name];
  if (/Burger/i.test(name)) return `${name.replace(/ Burger/i, "").toLowerCase()} patty, a fresh bun, and restrained classic burger accompaniments`;
  if (/Pizza/i.test(name)) return `${name.replace(/ Pizza/i, "").toLowerCase() || "classic"} pizza topping, tomato base, cheese, and baked pizza crust`;
  if (/Sandwich/i.test(name)) return `${name.replace(/ Sandwich/i, "").toLowerCase()} filling and fresh bread with restrained sandwich accompaniments`;
  if (/Wrap/i.test(name)) return `${name.replace(/ Wrap/i, "").toLowerCase()} filling wrapped neatly in soft flatbread`;
  if (/Juice/i.test(name)) return `${name.replace(/ Juice/i, "").toLowerCase()} fruit prepared as fresh juice without unrelated fruit`;
  if (/Milkshake/i.test(name)) return `${name.replace(/ Milkshake/i, "").toLowerCase()} flavor blended into a smooth milkshake`;
  if (/Coffee|Espresso|Macchiato|Latte|Cappuccino|Americano|Mocha/i.test(name)) return "properly extracted coffee prepared in the named traditional style";
  if (/Tea/i.test(name)) return `${name.replace(/ Tea/i, "").toLowerCase() || "tea"} infusion prepared in the named style`;
  if (/Salad/i.test(name)) return `${name.replace(/ Salad/i, "").toLowerCase() || "fresh"} salad components, visibly fresh and correctly portioned`;
  if (/Soup/i.test(name)) return `${name.replace(/ Soup/i, "").toLowerCase()} soup base with a smooth or naturally textured finish appropriate to the dish`;
  if (/Chicken/i.test(name)) return "recognizable chicken prepared exactly in the style named, with restrained appropriate accompaniments";
  if (/Beef|Steak/i.test(name)) return "recognizable beef prepared exactly in the style named, with restrained appropriate accompaniments";
  if (/Fish|Tuna/i.test(name)) return "recognizable fish prepared exactly in the style named, with restrained appropriate accompaniments";
  return `the traditional core components of ${name}, with no unrelated toppings, sides, or substitutions`;
}

function origin(name) {
  return ORIGINS.find(([pattern]) => pattern.test(name))?.[1] ?? "International";
}

const negative = "No text, no logo, no watermark, no blur, no duplicate food, no extra plates, no people, no hands, no unrelated utensils, no unrealistic colors, no cartoon style, no CGI appearance, no excessive garnish.";
const specifications = [...all.values()].sort((a, b) => a.item_name.localeCompare(b.item_name)).map((item) => {
  const ingredientSummary = ingredients(item.item_name, item.category);
  const type = dishType(item.category, item.item_name);
  const angle = camera(item.category, item.item_name);
  return {
    id: stableId(item.item_name),
    item_name: item.item_name,
    slug: slug(item.item_name),
    category: item.category,
    business_types_using_this_item: [...item.businessTypes].sort(),
    food_origin: origin(item.item_name),
    dish_type: type,
    serving_style: type === "Beverage" ? "Single freshly prepared serving in appropriate clean drinkware" : "One realistic restaurant portion, served fresh and ready for the customer",
    plate_style: type === "Beverage" ? "Clean neutral cup or glass appropriate to the beverage" : type === "Baked good" ? "Neutral bakery display plate or clean presentation surface" : "Simple white or neutral restaurant plate or bowl appropriate to the dish",
    camera_angle: angle,
    composition: `One complete ${item.item_name} as the clear focal point, naturally centered with realistic proportions and uncluttered spacing`,
    background: "Clean white or warm neutral background with no branding, text, people, or distracting objects",
    lighting: "Soft natural restaurant lighting with realistic highlights, gentle shadows, accurate color, and high realism",
    garnish: "Only minimal garnish authentic to the named dish; omit garnish when it is not traditionally appropriate",
    ingredients_summary: ingredientSummary,
    visual_description: `Authentic ${item.item_name} showing ${ingredientSummary}. Correct color, texture, portion, and professional restaurant-quality presentation on a neutral background, photographed from ${angle}.`,
    negative_prompt: negative,
    image_status: "PLACEHOLDER",
    version: 1,
    active: true,
  };
});

if (specifications.length !== 180) throw new Error(`Expected 180 unique approved items, received ${specifications.length}.`);
const output = resolve(root, "src/modules/setup-wizard/data/masterDishSpecifications.v1.json");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({ version: "1.0", source: "Phase 9.12.2 approved Smart Menu Library", specifications }, null, 2)}\n`, "utf8");
console.log(`Generated ${specifications.length} deterministic master dish specifications.`);
