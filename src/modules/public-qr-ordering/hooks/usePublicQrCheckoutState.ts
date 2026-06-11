import { useEffect, useMemo, useState } from "react";

type StoredCheckoutState = {
  checkoutVisible: boolean;
  customerName: string;
};

const CHECKOUT_STORAGE_PREFIX = "serveflow.publicQrCheckout";

function getCheckoutStorageKey(restaurantSlug: string) {
  return `${CHECKOUT_STORAGE_PREFIX}:${restaurantSlug}`;
}

function isStoredCheckoutState(value: unknown): value is StoredCheckoutState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Partial<StoredCheckoutState>;

  return typeof payload.checkoutVisible === "boolean" && typeof payload.customerName === "string";
}

function readStoredCheckoutState(restaurantSlug: string): StoredCheckoutState {
  if (typeof window === "undefined") {
    return { checkoutVisible: false, customerName: "" };
  }

  try {
    const storedValue = window.localStorage.getItem(getCheckoutStorageKey(restaurantSlug));

    if (!storedValue) {
      return { checkoutVisible: false, customerName: "" };
    }

    const parsedValue: unknown = JSON.parse(storedValue);

    return isStoredCheckoutState(parsedValue)
      ? parsedValue
      : { checkoutVisible: false, customerName: "" };
  } catch {
    return { checkoutVisible: false, customerName: "" };
  }
}

function readTableNumber() {
  if (typeof window === "undefined") {
    return undefined;
  }

  return new URLSearchParams(window.location.search).get("t")?.trim() || undefined;
}

export function usePublicQrCheckoutState(restaurantSlug: string) {
  const [checkoutVisible, setCheckoutVisible] = useState(
    () => readStoredCheckoutState(restaurantSlug).checkoutVisible
  );
  const [customerName, setCustomerName] = useState(
    () => readStoredCheckoutState(restaurantSlug).customerName
  );
  const tableNumber = useMemo(() => readTableNumber(), []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        getCheckoutStorageKey(restaurantSlug),
        JSON.stringify({ checkoutVisible, customerName })
      );
    } catch {
      // localStorage may be unavailable in private browsing or embedded webviews.
    }
  }, [checkoutVisible, customerName, restaurantSlug]);

  return {
    checkoutVisible,
    customerName,
    tableNumber,
    setCheckoutVisible,
    setCustomerName,
    resetCheckoutState: () => {
      setCheckoutVisible(false);
      setCustomerName("");
    },
  };
}
