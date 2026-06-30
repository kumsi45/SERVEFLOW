export function formatETBPrice(price: number) {
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(price)} ETB`;
}
