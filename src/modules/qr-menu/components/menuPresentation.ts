export function formatETBPrice(price: number) {
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(price)} ETB`;
}

export function formatNutritionNumber(value: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
}
