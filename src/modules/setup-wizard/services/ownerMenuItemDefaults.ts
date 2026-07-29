export const SERVEFLOW_MENU_PLACEHOLDER_IMAGE =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="#f1f5f9"/><circle cx="320" cy="205" r="74" fill="#dbe5df"/><path d="M247 204h146M320 131v146" stroke="#50705c" stroke-width="18" stroke-linecap="round"/><text x="320" y="342" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" font-weight="700" fill="#334155">ServeFlow Menu</text></svg>',
  );

export function createSafeMenuDescription(foodName: string) {
  const name = foodName.trim();
  const normalized = name.toLocaleLowerCase();
  let description: string;

  if (normalized.includes("macchiato")) {
    description = "Fresh espresso topped with smooth steamed milk.";
  } else if (normalized.includes("tibs")) {
    description = `${name} prepared in a traditional Ethiopian style and served fresh.`;
  } else if (normalized.includes("burger")) {
    description = `${name} freshly prepared and served for a satisfying meal.`;
  } else if (/coffee|espresso|latte|cappuccino|tea|juice|smoothie|milkshake/.test(normalized)) {
    description = `${name} freshly prepared and served for a refreshing experience.`;
  } else {
    description = `${name} carefully prepared and served fresh for a satisfying dining experience.`;
  }

  return description.slice(0, 160);
}
