import { useMemo, useState } from "react";
import type { CartLine, CartLineDetail, OrderingMenuItem } from "../types";

export function useCart(items: OrderingMenuItem[]) {
  const [cartLines, setCartLines] = useState<CartLine[]>([]);

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const cartDetails: CartLineDetail[] = useMemo(
    () =>
      cartLines
        .map((line) => {
          const item = itemById.get(line.menuItemId);

          if (!item) {
            return null;
          }

          return {
            ...line,
            item,
            lineTotal: Number(item.price) * line.quantity,
          };
        })
        .filter((line): line is CartLineDetail => Boolean(line)),
    [cartLines, itemById]
  );

  const total = useMemo(
    () => cartDetails.reduce((sum, line) => sum + line.lineTotal, 0),
    [cartDetails]
  );

  function addItem(menuItemId: string) {
    setCartLines((current) => {
      const existing = current.find((line) => line.menuItemId === menuItemId);

      if (existing) {
        return current.map((line) =>
          line.menuItemId === menuItemId
            ? { ...line, quantity: Math.min(line.quantity + 1, 99) }
            : line
        );
      }

      return [...current, { menuItemId, quantity: 1 }];
    });
  }

  function decrementItem(menuItemId: string) {
    setCartLines((current) =>
      current
        .map((line) =>
          line.menuItemId === menuItemId ? { ...line, quantity: line.quantity - 1 } : line
        )
        .filter((line) => line.quantity > 0)
    );
  }

  function removeItem(menuItemId: string) {
    setCartLines((current) => current.filter((line) => line.menuItemId !== menuItemId));
  }

  function clearCart() {
    setCartLines([]);
  }

  return {
    cartLines,
    cartDetails,
    total,
    addItem,
    decrementItem,
    removeItem,
    clearCart,
  };
}
