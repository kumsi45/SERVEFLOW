// Public native bridge endpoint. Deployment must keep verify_jwt=false;
// proof possession and durable rate limits are enforced inside this handler.
import { parseDigestKeyring } from "../_shared/printBridgePairingCore.ts";
import { errorResponse } from "../_shared/printBridgeHttp.ts";
import { handlePublicBridgeRequest } from "../_shared/printBridgePublicHandler.ts";
import { parseStableRateKey, upstashRateLimiter } from "../_shared/printBridgeRateLimit.ts";
import { createPrintBridgePorts, printBridgeEnvironment } from "../_shared/printBridgeSupabase.ts";

Deno.serve(async (request) => {
  try {
    const config = printBridgeEnvironment();
    const keys = parseDigestKeyring(config.keyring);
    const rate = upstashRateLimiter(config.redisUrl, config.redisToken, keys,
      fetch, parseStableRateKey(config.rateKey));
    const ports = createPrintBridgePorts(config, rate);
    return await handlePublicBridgeRequest(request, ports, keys, config.emailDomain);
  } catch (error) { return errorResponse(error); }
});
