// Operator/scheduler-only orphan cleanup. No credentials are returned.
import { parseDigestKeyring, reconcileOrphanIdentities } from "../_shared/printBridgePairingCore.ts";
import { errorResponse, pairingResponse } from "../_shared/printBridgeHttp.ts";
import { createPrintBridgePorts, printBridgeEnvironment } from "../_shared/printBridgeSupabase.ts";

function equalSecret(expected: string, supplied: string | null): boolean {
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(supplied ?? "");
  let difference = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ (b[i] ?? 0);
  return difference === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return pairingResponse(405, { error: "METHOD_NOT_ALLOWED" });
  try {
    const secret = Deno.env.get("PRINT_BRIDGE_MAINTENANCE_KEY") ?? "";
    if (secret.length < 43 || !equalSecret(secret,
      request.headers.get("x-print-bridge-maintenance-key"))) {
      return pairingResponse(403, { error: "UNAUTHORIZED" });
    }
    const config = printBridgeEnvironment();
    parseDigestKeyring(config.keyring); // fail closed on missing or invalid key configuration
    const ports = createPrintBridgePorts(config, async () => {});
    return pairingResponse(200,
      await reconcileOrphanIdentities(ports, config.emailDomain));
  } catch (error) { return errorResponse(error); }
});
