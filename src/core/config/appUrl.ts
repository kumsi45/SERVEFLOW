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

export function getPasswordResetRedirectUrl() {
  return `${getAppOrigin()}/reset-password`;
}
