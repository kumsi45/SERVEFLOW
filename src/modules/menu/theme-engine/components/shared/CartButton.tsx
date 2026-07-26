export function CartButton({ itemCount, subtotal, onOpen }: { itemCount: number; subtotal: string; onOpen: () => void }) {
  return <button className="menu-theme-cart-button" type="button" onClick={onOpen} aria-label={`Open cart with ${itemCount} items`}><span>Cart · {itemCount}</span><strong>{subtotal}</strong></button>;
}
