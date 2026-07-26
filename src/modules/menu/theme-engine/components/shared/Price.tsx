export function Price({ value, label = "Price" }: { value: string; label?: string }) {
  return <span className="menu-theme-price" aria-label={`${label}: ${value}`}>{value}</span>;
}
