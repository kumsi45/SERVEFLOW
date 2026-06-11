import { useEffect, useMemo, useState } from "react";
import type { AddPublicQrCartItemInput, PublicQrCartItem } from "../types";

const MIN_QUANTITY = 1;
const MAX_QUANTITY = 99;
const CART_STORAGE_PREFIX = "serveflow.publicQrCart";

function getCartStorageKey(restaurantSlug: string) {
  return `${CART_STORAGE_PREFIX}:${restaurantSlug}`;
}

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

function normalizeCartItem(item: unknown): PublicQrCartItem | undefined {
  if (!item || typeof item !== "object") {
    return undefined;
  }

  const payload = item as Partial<PublicQrCartItem>;

  if (
    typeof payload.menuItemId !== "string" ||
    typeof payload.name !== "string" ||
    typeof payload.price !== "number" ||
    !Number.isFinite(payload.price)
  ) {
    return undefined;
  }

  return {
    menuItemId: payload.menuItemId,
    name: payload.name,
    price: payload.price,
    quantity: normalizeQuantity(payload.quantity),
    notes: normalizeNotes(payload.notes),
  };
}

function readStoredCartItems(restaurantSlug: string): PublicQrCartItem[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const storedValue = window.localStorage.getItem(getCartStorageKey(restaurantSlug));

    if (!storedValue) {
      return [];
    }

    const parsedValue: unknown = JSON.parse(storedValue);

    return Array.isArray(parsedValue) ? parsedValue.flatMap((item) => normalizeCartItem(item) ?? []) : [];
  } catch {
    return [];
  }
}

export function usePublicQrCart(restaurantSlug: string) {
  const [items, setItems] = useState<PublicQrCartItem[]>(() => readStoredCartItems(restaurantSlug));

  const itemCount = useMemo(
    () => items.reduce((total, item) => total + item.quantity, 0),
    [items]
  );

  const displaySubtotal = useMemo(
    () => items.reduce((total, item) => total + item.price * item.quantity, 0),
    [items]
  );

  useEffect(() => {
    try {
      const storageKey = getCartStorageKey(restaurantSlug);

      if (items.length > 0) {
        window.localStorage.setItem(storageKey, JSON.stringify(items));
        return;
      }

      window.localStorage.removeItem(storageKey);
    } catch {
      // localStorage may be unavailable in private browsing or embedded webviews.
    }
  }, [items, restaurantSlug]);

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
