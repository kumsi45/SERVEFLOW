import { useMemo, useState } from "react";
import type { AddPublicQrCartItemInput, PublicQrCartItem } from "../types";

const MIN_QUANTITY = 1;
const MAX_QUANTITY = 99;

function normalizeQuantity(quantity: number | undefined) {
  if (typeof quantity !== "number" || !Number.isFinite(quantity)) {
    return MIN_QUANTITY;
  }

  return Math.min(Math.max(Math.trunc(quantity), MIN_QUANTITY), MAX_QUANTITY);
}

function normalizeNotes(notes: string | undefined) {
  const normalized = notes?.trim();

  return normalized ? normalized : undefined;
}

export function usePublicQrCart() {
  const [items, setItems] = useState<PublicQrCartItem[]>([]);

  const itemCount = useMemo(
    () => items.reduce((total, item) => total + item.quantity, 0),
    [items]
  );

  const displaySubtotal = useMemo(
    () => items.reduce((total, item) => total + item.price * item.quantity, 0),
    [items]
  );

  function addItem(input: AddPublicQrCartItemInput) {
    const quantity = normalizeQuantity(input.quantity);
    const notes = normalizeNotes(input.notes);

    setItems((currentItems) => {
      const existingItem = currentItems.find((item) => item.menuItemId === input.menuItemId);

      if (!existingItem) {
        return [
          ...currentItems,
          {
            menuItemId: input.menuItemId,
            name: input.name,
            price: input.price,
            quantity,
            notes,
          },
        ];
      }

      return currentItems.map((item) =>
        item.menuItemId === input.menuItemId
          ? {
              ...item,
              name: input.name,
              price: input.price,
              quantity: normalizeQuantity(item.quantity + quantity),
              notes: notes ?? item.notes,
            }
          : item
      );
    });
  }

  function removeItem(menuItemId: string) {
    setItems((currentItems) => currentItems.filter((item) => item.menuItemId !== menuItemId));
  }

  function updateQuantity(menuItemId: string, quantity: number) {
    setItems((currentItems) =>
      currentItems
        .map((item) =>
          item.menuItemId === menuItemId
            ? { ...item, quantity: normalizeQuantity(quantity) }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  }

  function updateNotes(menuItemId: string, notes: string) {
    setItems((currentItems) =>
      currentItems.map((item) =>
        item.menuItemId === menuItemId ? { ...item, notes: normalizeNotes(notes) } : item
      )
    );
  }

  function clearCart() {
    setItems([]);
  }

  return {
    items,
    itemCount,
    displaySubtotal,
    addItem,
    removeItem,
    updateQuantity,
    updateNotes,
    clearCart,
  };
}
