export const ETB_TO_USD_RATE = 0.0074;

export function formatETBPrice(price: number) {
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(price)} ETB`;
}

export function formatUSDApproximation(price: number) {
  return `≈ $${(price * ETB_TO_USD_RATE).toFixed(2)} USD`;
}

export function getMenuItemRating(name: string) {
  const ratingSeed = name.length % 4;

  return (4.6 + ratingSeed * 0.1).toFixed(1);
}

export function getMenuItemBadge(name: string) {
  const normalizedName = name.toLowerCase();

  if (normalizedName.includes("tibs") || normalizedName.includes("kitfo")) {
    return "🔥 Popular";
  }

  if (normalizedName.includes("beyaynetu") || normalizedName.includes("special")) {
    return "⭐ Best Seller";
  }

  if (normalizedName.includes("cake") || normalizedName.includes("macchiato")) {
    return "💯 Recommended";
  }

  if (normalizedName.includes("juice") || normalizedName.includes("coffee")) {
    return "⚡ Fast Choice";
  }

  return undefined;
}
