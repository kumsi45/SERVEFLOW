const PIN_PATTERN = /^\d{4}$/;

function toHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function normalizeWaiterPin(value: unknown) {
  const pin = typeof value === "string" ? value.trim() : "";
  if (!PIN_PATTERN.test(pin)) throw new Error("PIN must be exactly 4 digits.");
  return pin;
}

export function requireWaiterPinPepper() {
  const pepper = Deno.env.get("WAITER_PIN_PEPPER")?.trim() ?? "";
  if (pepper.length < 32) throw new Error("WAITER_PIN_PEPPER is not configured.");
  return pepper;
}

export async function keyedFingerprint(pepper: string, value: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export function waiterPinFingerprint(pepper: string, restaurantId: string, pin: string) {
  return keyedFingerprint(pepper, `waiter-pin:v1:${restaurantId}:${pin}`);
}

export function waiterThrottleFingerprint(
  pepper: string,
  restaurantId: string,
  clientAddress: string,
) {
  return keyedFingerprint(
    pepper,
    `waiter-throttle:v1:${restaurantId}:${clientAddress}`,
  );
}

export async function waiterSupabasePassword(
  pepper: string,
  restaurantId: string,
  employeeId: string,
) {
  const digest = await keyedFingerprint(
    pepper,
    `waiter-auth-password:v1:${restaurantId}:${employeeId.toUpperCase()}`,
  );
  return `SfA1!${digest}`;
}
