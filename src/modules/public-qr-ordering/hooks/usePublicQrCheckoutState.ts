import { useEffect, useMemo, useState } from "react";
import { logPublicQrContext, readPublicQrContext } from "../services/publicQrContext";
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

function getCheckoutStorageKey(restaurantSlug: string, sessionKey = "") {
  const normalizedSessionKey = sessionKey.trim();
  return normalizedSessionKey
    ? `${CHECKOUT_STORAGE_PREFIX}:${restaurantSlug}:${normalizedSessionKey}`
    : `${CHECKOUT_STORAGE_PREFIX}:${restaurantSlug}`;
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

function readStoredCheckoutState(restaurantSlug: string, sessionKey = ""): StoredCheckoutState {
  if (typeof window === "undefined") {
    return { checkoutVisible: false, customerName: "", paymentMethod: "" };
  }

  try {
    const storedValue = window.localStorage.getItem(getCheckoutStorageKey(restaurantSlug, sessionKey));

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

export function usePublicQrCheckoutState(restaurantSlug: string) {
  const currentSearch = typeof window === "undefined" ? "" : window.location.search;
  const qrContext = useMemo(
    () => readPublicQrContext(restaurantSlug),
    [restaurantSlug, currentSearch]
  );
  const initialCheckoutState = useMemo(
    () => readStoredCheckoutState(restaurantSlug, qrContext.sessionKey),
    [qrContext.sessionKey, restaurantSlug]
  );
  const qrToken = qrContext.qrToken;
  const tableNumberFromQr = qrContext.tableNumberFromQr;
  const [checkoutVisible, setCheckoutVisible] = useState(
    () => initialCheckoutState.checkoutVisible
  );
  const [customerName, setCustomerName] = useState(
    () => initialCheckoutState.customerName
  );
  const [paymentMethod, setPaymentMethod] = useState<PublicQrPaymentMethod | "">(
    () => initialCheckoutState.paymentMethod
  );
  const [tableNumber, setTableNumber] = useState(() => qrContext.tableNumber);

  useEffect(() => {
    logPublicQrContext("usePublicQrCheckoutState:init", {
      restaurantSlug,
      tableNumber: qrContext.tableNumber,
      qrToken: qrContext.qrToken,
      source: qrContext.source,
    });
  }, [qrContext.qrToken, qrContext.source, qrContext.tableNumber, restaurantSlug]);

  useEffect(() => {
    const storedState = readStoredCheckoutState(restaurantSlug, qrContext.sessionKey);
    setCheckoutVisible(storedState.checkoutVisible);
    setCustomerName(storedState.customerName);
    setPaymentMethod(storedState.paymentMethod);
    setTableNumber(qrContext.tableNumber);
  }, [qrContext.sessionKey, qrContext.tableNumber, restaurantSlug]);

  useEffect(() => {
    try {
      if (!checkoutVisible && !customerName && !paymentMethod) {
        window.localStorage.removeItem(getCheckoutStorageKey(restaurantSlug, qrContext.sessionKey));
        return;
      }

      window.localStorage.setItem(
        getCheckoutStorageKey(restaurantSlug, qrContext.sessionKey),
        JSON.stringify({ checkoutVisible, customerName, paymentMethod })
      );
    } catch {
      // localStorage may be unavailable in private browsing or embedded webviews.
    }
  }, [checkoutVisible, customerName, paymentMethod, qrContext.sessionKey, restaurantSlug]);

  return {
    checkoutVisible,
    customerName,
    paymentMethod,
    tableNumber,
    qrToken,
    tableNumberFromQr,
    sessionKey: qrContext.sessionKey,
    browserSessionToken: qrContext.browserSessionToken,
    setCheckoutVisible,
    setCustomerName,
    setPaymentMethod,
    setTableNumber,
    resetCheckoutState: () => {
      setCheckoutVisible(false);
      setCustomerName("");
      setPaymentMethod("");
      setTableNumber(tableNumberFromQr ? qrContext.tableNumber : "");
      try {
        window.localStorage.removeItem(getCheckoutStorageKey(restaurantSlug, qrContext.sessionKey));
      } catch {
        // localStorage may be unavailable in private browsing or embedded webviews.
      }
    },
  };
}
