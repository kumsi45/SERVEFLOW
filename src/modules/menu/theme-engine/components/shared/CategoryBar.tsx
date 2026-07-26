import type { MenuCategory } from "../../../../qr-menu/types";

export function CategoryBar({ categories, activeId, onSelect }: { categories: readonly MenuCategory[]; activeId: string; onSelect: (id: string) => void }) {
  return <nav className="menu-theme-categories" aria-label="Menu categories"><button type="button" aria-current={activeId === "all" ? "page" : undefined} onClick={() => onSelect("all")}>All</button>{categories.map((category) => <button type="button" key={category.id} aria-current={activeId === category.id ? "page" : undefined} onClick={() => onSelect(category.id)}>{category.name}</button>)}</nav>;
}
