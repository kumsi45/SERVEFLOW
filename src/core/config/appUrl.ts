const DEFAULT_APP_ORIGIN = "https://serveflow.app";

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
  const hostname = new URL(origin).hostname.toLowerCase();
  return hostname === "localhost" || hostname === "::1" || hostname === "[::1]" || hostname.startsWith("127.");
}

export type PasswordRecoveryUrlConfig = {
  publicAppUrl?: string | null;
  legacyAppUrl?: string | null;
  browserOrigin?: string | null;
  production: boolean;
};

export function resolvePasswordRecoveryRedirectUrl(config: PasswordRecoveryUrlConfig) {
  const configuredOrigin = normalizeHttpOrigin(config.publicAppUrl) ?? normalizeHttpOrigin(config.legacyAppUrl);

  if (configuredOrigin) {
    if (config.production && isLoopbackOrigin(configuredOrigin)) {
      throw new Error("Password recovery is temporarily unavailable. Please contact your administrator.");
    }
    return `${configuredOrigin}/reset-password`;
  }

  if (!config.production) {
    const developmentOrigin = normalizeHttpOrigin(config.browserOrigin);
    if (developmentOrigin) return `${developmentOrigin}/reset-password`;
  }

  throw new Error("Password recovery is temporarily unavailable. Please contact your administrator.");
}

function getConfiguredPublicOrigin() {
  return (
    normalizeHttpOrigin(import.meta.env.VITE_PUBLIC_APP_URL) ??
    normalizeHttpOrigin(import.meta.env.VITE_APP_URL) ??
    normalizeHttpOrigin(import.meta.env.PUBLIC_APP_URL) ??
    DEFAULT_APP_ORIGIN
  );
}

export function getAppUrl() {
  return (
    normalizeHttpOrigin(import.meta.env.VITE_PUBLIC_APP_URL) ??
    normalizeHttpOrigin(import.meta.env.VITE_APP_URL) ??
    (typeof window === "undefined" ? null : normalizeHttpOrigin(window.location.origin)) ??
    DEFAULT_APP_ORIGIN
  );
}

export function getAppOrigin() {
  return getConfiguredPublicOrigin();
}

export function buildAbsolutePublicUrl(pathOrUrl: string | null | undefined) {
  const rawUrl = pathOrUrl?.trim() ?? "";
  if (!rawUrl) return "";

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    if (!rawUrl.startsWith("/")) return "";
    return `${getAppUrl()}${rawUrl}`;
  }
}

export function assertAbsoluteQrPayload(payload: string) {
  if (!/^https?:\/\//i.test(payload)) {
    throw new Error("Generated table QR payload must be an absolute public URL.");
  }
}

export function getPasswordResetRedirectUrl() {
  return resolvePasswordRecoveryRedirectUrl({
    publicAppUrl: import.meta.env.VITE_PUBLIC_APP_URL,
    legacyAppUrl: import.meta.env.VITE_APP_URL,
    browserOrigin: typeof window === "undefined" ? null : window.location.origin,
    production: import.meta.env.PROD,
  });
}
