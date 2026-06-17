import { useEffect, useMemo, useState } from "react";
import { PUBLIC_QR_PAYMENT_METHODS, type PublicQrPaymentMethod } from "../types";

type StoredCheckoutState = {
  checkoutVisible: boolean;
  customerName: string;
  paymentMethod: PublicQrPaymentMethod | "";
};

type StoredCheckoutPayload = {
  checkoutVisible: boolean;
  customerName: string;
  paymentMethod?: PublicQrPaymentMethod | "";
};

const CHECKOUT_STORAGE_PREFIX = "serveflow.publicQrCheckout";

function getCheckoutStorageKey(restaurantSlug: string) {
  return `${CHECKOUT_STORAGE_PREFIX}:${restaurantSlug}`;
}

function isStoredCheckoutState(value: unknown): value is StoredCheckoutPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Partial<StoredCheckoutPayload>;

  return (
    typeof payload.checkoutVisible === "boolean" &&
    typeof payload.customerName === "string" &&
    (typeof payload.paymentMethod === "undefined" ||
      payload.paymentMethod === "" ||
      PUBLIC_QR_PAYMENT_METHODS.includes(payload.paymentMethod as PublicQrPaymentMethod))
  );
}

function readStoredCheckoutState(restaurantSlug: string): StoredCheckoutState {
  if (typeof window === "undefined") {
    return { checkoutVisible: false, customerName: "", paymentMethod: "" };
  }

  try {
    const storedValue = window.localStorage.getItem(getCheckoutStorageKey(restaurantSlug));

    if (!storedValue) {
      return { checkoutVisible: false, customerName: "", paymentMethod: "" };
    }

    const parsedValue: unknown = JSON.parse(storedValue);

    return isStoredCheckoutState(parsedValue)
      ? { ...parsedValue, paymentMethod: parsedValue.paymentMethod ?? "" }
      : { checkoutVisible: false, customerName: "", paymentMethod: "" };
  } catch {
    return { checkoutVisible: false, customerName: "", paymentMethod: "" };
  }
}

function readTableNumber() {
  if (typeof window === "undefined") {
    return undefined;
  }

  return new URLSearchParams(window.location.search).get("t")?.trim() || undefined;
}

export function usePublicQrCheckoutState(restaurantSlug: string) {
  const initialCheckoutState = useMemo(() => readStoredCheckoutState(restaurantSlug), [restaurantSlug]);
  const [checkoutVisible, setCheckoutVisible] = useState(
    () => initialCheckoutState.checkoutVisible
  );
  const [customerName, setCustomerName] = useState(
    () => initialCheckoutState.customerName
  );
  const [paymentMethod, setPaymentMethod] = useState<PublicQrPaymentMethod | "">(
    () => initialCheckoutState.paymentMethod
  );
  const tableNumber = useMemo(() => readTableNumber(), []);

  useEffect(() => {
    try {
      if (!checkoutVisible && !customerName && !paymentMethod) {
        window.localStorage.removeItem(getCheckoutStorageKey(restaurantSlug));
        return;
      }

      window.localStorage.setItem(
        getCheckoutStorageKey(restaurantSlug),
        JSON.stringify({ checkoutVisible, customerName, paymentMethod })
      );
    } catch {
      // localStorage may be unavailable in private browsing or embedded webviews.
    }
  }, [checkoutVisible, customerName, paymentMethod, restaurantSlug]);

  return {
    checkoutVisible,
    customerName,
    paymentMethod,
    tableNumber,
    setCheckoutVisible,
    setCustomerName,
    setPaymentMethod,
    resetCheckoutState: () => {
      setCheckoutVisible(false);
      setCustomerName("");
      setPaymentMethod("");
      try {
        window.localStorage.removeItem(getCheckoutStorageKey(restaurantSlug));
      } catch {
        // localStorage may be unavailable in private browsing or embedded webviews.
      }
    },
  };
}
