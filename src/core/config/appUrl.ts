const DEFAULT_APP_ORIGIN = "http://localhost:5173";

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

function getConfiguredPublicOrigin() {
  return (
    normalizeHttpOrigin(import.meta.env.PUBLIC_APP_URL) ??
    normalizeHttpOrigin(import.meta.env.VITE_PUBLIC_APP_URL) ??
    normalizeHttpOrigin(import.meta.env.VITE_APP_URL) ??
    DEFAULT_APP_ORIGIN
  );
}

export function getAppOrigin() {
  return getConfiguredPublicOrigin();
}

export function getQrAppOrigin() {
  return getConfiguredPublicOrigin();
}

export function getQrAppUrl(pathOrUrl: string) {
  const rawValue = pathOrUrl.trim();
  if (!rawValue) {
    return "";
  }

  try {
    const url = new URL(rawValue);
    return `${url.origin}${url.pathname}${url.search}${url.hash}`;
  } catch {
    const origin = getQrAppOrigin();
    const path = rawValue.startsWith("/") ? rawValue : `/${rawValue}`;
    return `${origin}${path}`;
  }
}

export function getPasswordResetRedirectUrl() {
  return `${getAppOrigin()}/reset-password`;
}
