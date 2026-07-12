export type PublicQrContext = {
  restaurantSlug: string;
  tableNumber: string;
  qrToken: string;
  tableNumberFromQr: boolean;
  sessionKey: string;
  browserSessionToken: string;
  source: "url" | "empty";
};

export type PublicQrSession = {
  restaurantId: string | null;
  tableNumber: string;
  qrToken: string;
  sessionKey: string;
  activeOrderId: string | null;
};

const QR_CONTEXT_STORAGE_PREFIX = "serveflow.publicQrContext";
const QR_ACTIVE_SESSION_STORAGE_KEY = "serveflow.publicQrActiveSessionKey";
const QR_LEGACY_ACTIVE_SCAN_STORAGE_KEY = "serveflow.publicQrActiveScan";
const QR_CART_STORAGE_PREFIX = "serveflow.publicQrCart";
const QR_CHECKOUT_STORAGE_PREFIX = "serveflow.publicQrCheckout";
const QR_BROWSER_SESSION_STORAGE_PREFIX = "serveflow.publicQrBrowserSession";

function normalize(value: string | null | undefined) {
  return value?.trim() ?? "";
}

export function buildPublicQrSessionKey(restaurantSlug: string, tableNumber: string, qrToken: string) {
  return `${restaurantSlug.trim()}-${tableNumber.trim()}-${qrToken.trim()}`;
}

function readBrowserSessionToken(sessionKey: string) {
  if (typeof window === "undefined" || !sessionKey) return "";

  const storageKey = `${QR_BROWSER_SESSION_STORAGE_PREFIX}:${sessionKey}`;
  try {
    const storedToken = window.sessionStorage.getItem(storageKey);
    if (storedToken) return storedToken;

    const newToken = crypto.randomUUID();
    window.sessionStorage.setItem(storageKey, newToken);
    return newToken;
  } catch {
    return "";
  }
}

function clearPublicQrStorageForNewSession(sessionKey: string) {
  if (typeof window === "undefined" || !sessionKey) return;

  try {
    if (window.localStorage.getItem(QR_ACTIVE_SESSION_STORAGE_KEY) === sessionKey) return;

    const prefixesToClear = [
      QR_CONTEXT_STORAGE_PREFIX,
      QR_CART_STORAGE_PREFIX,
      QR_CHECKOUT_STORAGE_PREFIX,
    ];

    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key && prefixesToClear.some((prefix) => key === prefix || key.startsWith(`${prefix}:`))) {
        window.localStorage.removeItem(key);
      }
    }

    window.localStorage.removeItem(QR_LEGACY_ACTIVE_SCAN_STORAGE_KEY);
    window.localStorage.setItem(QR_ACTIVE_SESSION_STORAGE_KEY, sessionKey);
  } catch {
    // localStorage may be unavailable in private browsing or embedded webviews.
  }
}

export function readPublicQrContext(restaurantSlug: string): PublicQrContext {
  if (typeof window === "undefined") {
    return { restaurantSlug, tableNumber: "", qrToken: "", tableNumberFromQr: false, sessionKey: "", browserSessionToken: "", source: "empty" };
  }

  const params = new URLSearchParams(window.location.search);
  const tableNumberFromUrl = normalize(params.get("t") || params.get("table"));
  const qrTokenFromUrl = normalize(params.get("qr"));

  if (tableNumberFromUrl && qrTokenFromUrl) {
    const sessionKey = buildPublicQrSessionKey(restaurantSlug, tableNumberFromUrl, qrTokenFromUrl);
    clearPublicQrStorageForNewSession(sessionKey);
    return {
      restaurantSlug,
      tableNumber: tableNumberFromUrl,
      qrToken: qrTokenFromUrl,
      tableNumberFromQr: true,
      sessionKey,
      browserSessionToken: readBrowserSessionToken(sessionKey),
      source: "url",
    };
  }

  return {
    restaurantSlug,
    tableNumber: tableNumberFromUrl,
    qrToken: qrTokenFromUrl,
    tableNumberFromQr: Boolean(tableNumberFromUrl && qrTokenFromUrl),
    sessionKey: "",
    browserSessionToken: "",
    source: "empty",
  };
}

export function buildPublicQrSession(
  context: Pick<PublicQrContext, "tableNumber" | "qrToken" | "sessionKey">,
  restaurantId: string | null,
  activeOrderId: string | null
): PublicQrSession {
  return {
    restaurantId,
    tableNumber: context.tableNumber,
    qrToken: context.qrToken,
    sessionKey: context.sessionKey,
    activeOrderId,
  };
}

export function buildPublicQrContextUrl(path: string, context: Pick<PublicQrContext, "tableNumber" | "qrToken">) {
  const tableNumber = normalize(context.tableNumber);
  const qrToken = normalize(context.qrToken);

  if (!tableNumber || !qrToken) return path;

  const [pathAndSearch, hash = ""] = path.split("#");
  const [pathname, search = ""] = pathAndSearch.split("?");
  const params = new URLSearchParams(search);
  params.set("t", tableNumber);
  params.set("qr", qrToken);

  return `${pathname}?${params.toString()}${hash ? `#${hash}` : ""}`;
}

export function logPublicQrContext(stage: string, context: Record<string, unknown>) {
  const viteEnv = (import.meta as unknown as { env?: { DEV?: boolean } }).env;

  if (!viteEnv?.DEV || typeof window === "undefined") return;

  console.debug("[ServeFlow QR]", stage, context);
}
