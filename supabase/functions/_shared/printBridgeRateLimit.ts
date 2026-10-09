import { digest, PairingError, type DigestKeyring } from "./printBridgePairingCore.ts";

const SCRIPT = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],tonumber(ARGV[1])); end; return n";

export function upstashRateLimiter(
  url: string, token: string, keys: DigestKeyring,
  request: typeof fetch = fetch,
) {
  let endpoint: URL;
  try { endpoint = new URL(url); }
  catch { throw new Error("Invalid print bridge rate limiter configuration."); }
  if (endpoint.protocol !== "https:" || !token || endpoint.username || endpoint.password ||
    endpoint.search || endpoint.hash) {
    throw new Error("Invalid print bridge rate limiter configuration.");
  }
  return async (scope: string, identity: string, maximum: number, windowSeconds: number) => {
    if (!/^[a-z-]{1,40}$/.test(scope) || maximum < 1 || windowSeconds < 1) {
      throw new Error("Invalid print bridge rate limit policy.");
    }
    // A retained setup-token signing key must keep the same replay bucket during
    // digest-key rotation. Other rate budgets use the current key.
    let rateVersion = keys.current;
    if (scope === "setup-token") {
      const [version, nonce, extra] = identity.split(":");
      if (extra || !keys.keys[version] || !/^[A-Za-z0-9_-]{43}$/.test(nonce)) {
        throw new Error("Invalid setup-token rate identity.");
      }
      rateVersion = version;
    }
    const fingerprint = await digest(keys.keys[rateVersion], rateVersion,
      "rate", `${scope}:${identity}`);
    const redisKey = `serveflow:p32:${scope}:${fingerprint}`;
    let count: unknown;
    try {
      const response = await request(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(["EVAL", SCRIPT, 1, redisKey, windowSeconds]),
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) throw new Error("Rate limiter unavailable.");
      const body = await response.json() as { result?: unknown; error?: unknown };
      if (body.error) throw new Error("Rate limiter unavailable.");
      count = body.result;
    } catch {
      throw new PairingError("RATE_LIMIT_UNAVAILABLE", 503, "Pairing service is temporarily unavailable.");
    }
    if (!Number.isInteger(count) || (count as number) < 1) {
      throw new PairingError("RATE_LIMIT_UNAVAILABLE", 503, "Pairing service is temporarily unavailable.");
    }
    if ((count as number) > maximum) {
      throw new PairingError("RATE_LIMITED", 429, "Too many pairing attempts. Try later.");
    }
  };
}
