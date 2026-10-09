// Authenticated Owner endpoint. The JWT user ID is derived server-side.
import { approvePairing, cancelPairing, initiatePairing, parseDigestKeyring,
  revokeAgent } from "../_shared/printBridgePairingCore.ts";
import { errorResponse, pairingResponse, smallJson } from "../_shared/printBridgeHttp.ts";
import { upstashRateLimiter } from "../_shared/printBridgeRateLimit.ts";
import { createPrintBridgePorts, printBridgeEnvironment } from "../_shared/printBridgeSupabase.ts";

Deno.serve(async (request) => {
  let origin: string | undefined;
  try {
    const config = printBridgeEnvironment();
    const requestOrigin = request.headers.get("Origin");
    if (requestOrigin && requestOrigin !== config.ownerOrigin) {
      return pairingResponse(403, { error: "ORIGIN_DENIED" });
    }
    origin = requestOrigin ?? undefined;
    if (request.method === "OPTIONS") return pairingResponse(204, {}, origin);
    if (request.method !== "POST") return pairingResponse(405, { error: "METHOD_NOT_ALLOWED" }, origin);
    const keys = parseDigestKeyring(config.keyring);
    const rate = upstashRateLimiter(config.redisUrl, config.redisToken, keys);
    const ports = createPrintBridgePorts(config, rate, request.headers.get("Authorization") ?? undefined);
    const ownerId = await ports.authenticateOwner();
    const body = await smallJson(request);
    if (body.action === "initiate") {
      return pairingResponse(200, await initiatePairing(ports, keys, ownerId, body.restaurantId), origin);
    }
    if (body.action === "approve") {
      return pairingResponse(200, await approvePairing(ports, keys, body, ownerId), origin);
    }
    if (body.action === "cancel") {
      return pairingResponse(200, await cancelPairing(ports, ownerId, body), origin);
    }
    if (body.action === "revoke" || body.action === "rotate") {
      const result = await revokeAgent(ports, ownerId, body);
      return pairingResponse(200, body.action === "rotate" ?
        { ...result, replacementPairingRequired: true } : result, origin);
    }
    return pairingResponse(400, { error: "INVALID_REQUEST" }, origin);
  } catch (error) { return errorResponse(error, origin); }
});
