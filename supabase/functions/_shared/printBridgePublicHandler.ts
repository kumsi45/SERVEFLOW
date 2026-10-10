import { redeemPairing, startPairing, type DigestKeyring,
  type PairingPorts } from "./printBridgePairingCore.ts";
import { pairingResponse, smallJson } from "./printBridgeHttp.ts";

export async function handlePublicBridgeRequest(request: Request, ports: PairingPorts,
  keys: DigestKeyring, emailDomain: string): Promise<Response> {
  if (request.method !== "POST") return pairingResponse(405, { error: "METHOD_NOT_ALLOWED" });
  const body = await smallJson(request);
  if (body.action === "start") {
    return pairingResponse(200, await startPairing(ports, keys, body));
  }
  if (body.action === "redeem") {
    return pairingResponse(200, await redeemPairing(ports, keys, body, emailDomain));
  }
  return pairingResponse(400, { error: "INVALID_REQUEST" });
}
