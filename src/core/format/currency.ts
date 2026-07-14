export type CurrencyConfig = {
  currencyCode?: string | null;
  currencySymbol?: string | null;
  locale?: string | null;
};

type NormalizedCurrencyConfig = {
  currencyCode: string;
  currencySymbol: string;
  locale: string;
};

export const DEFAULT_CURRENCY: NormalizedCurrencyConfig = {
  currencyCode: "ETB",
  currencySymbol: "Br",
  locale: "am-ET",
};

export function normalizeCurrencyConfig(config?: CurrencyConfig | null): NormalizedCurrencyConfig {
  return {
    currencyCode: config?.currencyCode?.trim() || DEFAULT_CURRENCY.currencyCode,
    currencySymbol: config?.currencySymbol?.trim() || DEFAULT_CURRENCY.currencySymbol,
    locale: config?.locale?.trim() || DEFAULT_CURRENCY.locale,
  };
}

export function formatCurrency(value: number | string | null | undefined, config?: CurrencyConfig | null) {
  const amount = Number(value ?? 0);
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const currency = normalizeCurrencyConfig(config);

  const formattedNumber = new Intl.NumberFormat(currency.locale, {
    maximumFractionDigits: Number.isInteger(safeAmount) ? 0 : 2,
    minimumFractionDigits: 0,
  }).format(safeAmount);

  return `${currency.currencySymbol} ${formattedNumber}`;
}

export function formatCompactCurrency(value: number | string | null | undefined, config?: CurrencyConfig | null) {
  const amount = Number(value ?? 0);
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  if (Math.abs(safeAmount) < 1000) return formatCurrency(safeAmount, config);

  const currency = normalizeCurrencyConfig(config);
  const compact = new Intl.NumberFormat(currency.locale, {
    notation: "compact",
    maximumFractionDigits: Math.abs(safeAmount) >= 10000 ? 0 : 1,
  }).format(safeAmount);

  return `${currency.currencySymbol} ${compact}`;
}
