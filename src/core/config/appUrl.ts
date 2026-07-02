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

export function getAppOrigin() {
  const configuredOrigin = normalizeHttpOrigin(import.meta.env.VITE_APP_URL);
  const browserOrigin = normalizeHttpOrigin(window.location.origin);

  if (configuredOrigin && (!browserOrigin || isLoopbackOrigin(browserOrigin))) {
    return configuredOrigin;
  }

  return browserOrigin ?? configuredOrigin;
}

export function getPasswordResetRedirectUrl() {
  const appOrigin = getAppOrigin();

  if (!appOrigin) {
    throw new Error("ServeFlow app URL is not configured. Set VITE_APP_URL to your public app URL.");
  }

  return `${appOrigin}/reset-password`;
}
