import { formatCurrency, type CurrencyConfig } from "../../../core/format/currency";

let activeMenuCurrency: CurrencyConfig | null = null;

export function setMenuCurrency(config: CurrencyConfig | null | undefined) {
  activeMenuCurrency = config ?? null;
}

export function formatMenuPrice(price: number) {
  return formatCurrency(price, activeMenuCurrency);
}

export function formatNutritionNumber(value: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
}

