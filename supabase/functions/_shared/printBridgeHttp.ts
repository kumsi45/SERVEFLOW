import { PairingError } from "./printBridgePairingCore.ts";

export async function smallJson(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new PairingError("INVALID_REQUEST", 400, "Invalid pairing request.");
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) throw new PairingError("INVALID_REQUEST", 400, "Invalid pairing request.");
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new PairingError("INVALID_REQUEST", 400, "Invalid pairing request."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PairingError("INVALID_REQUEST", 400, "Invalid pairing request.");
  }
  return value as Record<string, unknown>;
}

export function pairingResponse(status: number, body: Record<string, unknown>, origin?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store, private",
    "Pragma": "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "authorization, apikey, content-type";
    headers.Vary = "Origin";
  }
  return new Response([204, 205, 304].includes(status) ? null : JSON.stringify(body),
    { status, headers });
}

export function errorResponse(error: unknown, origin?: string) {
  if (error instanceof PairingError) {
    return pairingResponse(error.status, { error: error.code, message: error.message }, origin);
  }
  return pairingResponse(503, { error: "PAIRING_UNAVAILABLE",
    message: "Pairing service is temporarily unavailable." }, origin);
}
