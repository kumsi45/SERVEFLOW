function normalizeHttpOrigin(value: string | undefined | null) {
  const rawValue = value?.trim();

  if (!rawValue || rawValue.toLowerCase() === "null") {
    return null;
  }

  try {
    const url = new URL(rawValue);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

function isLoopbackOrigin(origin: string) {
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function getConfiguredPublicOrigin() {
  return (
    normalizeHttpOrigin(import.meta.env.PUBLIC_APP_URL) ??
    normalizeHttpOrigin(import.meta.env.VITE_PUBLIC_APP_URL) ??
    normalizeHttpOrigin(import.meta.env.VITE_APP_URL)
  );
}

function getBrowserOrigin() {
  if (typeof window === "undefined") {
    return null;
  }

  return normalizeHttpOrigin(window.location.origin);
}

export function getAppOrigin() {
  const configuredOrigin = getConfiguredPublicOrigin();
  const browserOrigin = getBrowserOrigin();

  if (configuredOrigin && (!browserOrigin || isLoopbackOrigin(browserOrigin))) {
    return configuredOrigin;
  }

  return browserOrigin ?? configuredOrigin;
}

export function getQrAppOrigin() {
  const configuredOrigin = getConfiguredPublicOrigin();
  if (configuredOrigin) {
    return configuredOrigin;
  }

  const browserOrigin = getBrowserOrigin();
  if (browserOrigin && !isLoopbackOrigin(browserOrigin)) {
    return browserOrigin;
  }

  throw new Error("QR base URL is not configured. Set PUBLIC_APP_URL to your production domain, or open ServeFlow from its LAN URL before generating QR codes.");
}

export function getQrAppUrl(pathOrUrl: string) {
  const rawValue = pathOrUrl.trim();
  if (!rawValue) {
    return "";
  }

  const origin = getQrAppOrigin();

  try {
    const url = new URL(rawValue);
    return `${origin}${url.pathname}${url.search}${url.hash}`;
  } catch {
    const path = rawValue.startsWith("/") ? rawValue : `/${rawValue}`;
    return `${origin}${path}`;
  }
}

export function getPasswordResetRedirectUrl() {
  const appOrigin = getAppOrigin();

  if (!appOrigin) {
    throw new Error("ServeFlow app URL is not configured. Set PUBLIC_APP_URL to your public app URL.");
  }

  return `${appOrigin}/reset-password`;
}
