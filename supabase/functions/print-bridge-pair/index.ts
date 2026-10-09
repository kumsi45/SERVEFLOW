// Public native bridge endpoint. Deployment must keep verify_jwt=false;
// proof possession and durable rate limits are enforced inside this handler.
import { parseDigestKeyring, redeemPairing, startPairing } from "../_shared/printBridgePairingCore.ts";
import { errorResponse, pairingResponse, smallJson } from "../_shared/printBridgeHttp.ts";
import { upstashRateLimiter } from "../_shared/printBridgeRateLimit.ts";
import { createPrintBridgePorts, printBridgeEnvironment } from "../_shared/printBridgeSupabase.ts";

Deno.serve(async (request) => {
  if (request.method !== "POST") return pairingResponse(405, { error: "METHOD_NOT_ALLOWED" });
  try {
    const config = printBridgeEnvironment();
    const keys = parseDigestKeyring(config.keyring);
    const rate = upstashRateLimiter(config.redisUrl, config.redisToken, keys);
    const ports = createPrintBridgePorts(config, rate);
    const body = await smallJson(request);
    if (body.action === "start") {
      const result = await startPairing(ports, keys, body);
      return pairingResponse(200, result);
    }
    if (body.action === "redeem") {
      const result = await redeemPairing(ports, keys, body, config.emailDomain);
      return pairingResponse(200, result);
    }
    return pairingResponse(400, { error: "INVALID_REQUEST" });
  } catch (error) { return errorResponse(error); }
});
