export type BottomNavigationItem = { id: string; label: string; onSelect: () => void };

export function BottomNavigation({ items, activeId }: { items: readonly BottomNavigationItem[]; activeId?: string }) {
  return <nav className="menu-theme-bottom-nav" aria-label="Menu navigation">{items.map((item) => <button type="button" key={item.id} aria-current={activeId === item.id ? "page" : undefined} onClick={item.onSelect}>{item.label}</button>)}</nav>;
}
