export function formatETBPrice(price: number) {
  return `ETB ${new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(price)}`;
}

export function formatNutritionNumber(value: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
}
