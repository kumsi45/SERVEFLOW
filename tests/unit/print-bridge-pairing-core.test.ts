import { describe, expect, it, vi } from "vitest";
import { approvePairing, cancelPairing, generateBridgeProof, initiatePairing, parseDigestKeyring,
  PairingError, reconcileOrphanIdentities, redeemPairing, revokeAgent, startPairing, type PairingPorts, type PairingSnapshot,
  type SessionMaterial } from "../../supabase/functions/_shared/printBridgePairingCore";
import { upstashRateLimiter } from "../../supabase/functions/_shared/printBridgeRateLimit";
import { handlePublicBridgeRequest } from "../../supabase/functions/_shared/printBridgePublicHandler";

const owner = crypto.randomUUID();
const tenantA = crypto.randomUUID();
const tenantB = crypto.randomUUID();
const keys = parseDigestKeyring(JSON.stringify({ current: "v1",
  keys: { v1: generateBridgeProof() } }));

class MockPorts implements PairingPorts {
  pairings = new Map<string, PairingSnapshot & {
    code: string; proof: string; restaurant: string | null; owner: string | null;
  }>();
  agents = new Map<string, { auth_user_id: string; tenant: string; revoked: boolean }>();
  identities = new Map<string, string>();
  rate = new Map<string, number>();
  durableClaims = new Set<string>();
  created = 0;
  deleted = 0;
  banned = 0;
  createFails = false;
  signInFails = false;
  completeFails = false;
  deleteFails = false;
  banFails = false;
  async limit(scope: string, identity: string, maximum: number) {
    const key = `${scope}:${identity}`;
    const next = (this.rate.get(key) ?? 0) + 1;
    this.rate.set(key, next);
    if (next > maximum) throw new Error("rate limited");
  }
  async begin(code: string, proof: string, _name: string, _ttl: number,
    setupDigest: string, ownerId: string, restaurantId: string, expiresAt: string) {
    if (this.durableClaims.has(setupDigest) || ownerId !== owner || restaurantId !== tenantA ||
      Date.parse(expiresAt) <= Date.now()) {
      throw new PairingError("INVALID_SETUP", 403, "Owner setup authorization is unavailable.");
    }
    this.durableClaims.add(setupDigest);
    const pairingId = crypto.randomUUID();
    this.pairings.set(pairingId, { status: "pending", code, proof,
      restaurant: null, owner: null, agent_id: null, agent_auth_user_id: null,
      expires_at: new Date(Date.now() + 300_000).toISOString() });
    return pairingId;
  }
  async proofMatches(pairingId: string, proofDigests: string[]) {
    const pair = this.pairings.get(pairingId);
    return Boolean(pair && pair.status === "approved" &&
      Date.parse(pair.expires_at!) > Date.now() && proofDigests.includes(pair.proof));
  }
  async approve(pairingId: string, code: string, restaurantId: string, ownerId: string) {
    const pair = this.pairings.get(pairingId);
    if (!pair || pair.status !== "pending" || pair.code !== code || ownerId !== owner) throw new Error("unavailable");
    pair.status = "approved"; pair.restaurant = restaurantId; pair.owner = ownerId;
  }
  async beginRedemption(pairingId: string, proof: string) {
    const pair = this.pairings.get(pairingId);
    if (!pair || pair.status !== "approved" || pair.proof !== proof) throw new Error("unavailable");
    pair.status = "redeeming";
    return { restaurant_id: pair.restaurant!, bridge_name: "Test Bridge" };
  }
  async complete(pairingId: string, authUserId: string) {
    if (this.completeFails) throw new Error("binding failed");
    const pair = this.pairings.get(pairingId)!;
    if (pair.status === "completed" && pair.agent_auth_user_id === authUserId) return pair.agent_id!;
    if (pair.status !== "redeeming") throw new Error("unavailable");
    const agentId = crypto.randomUUID();
    pair.status = "completed"; pair.agent_id = agentId; pair.agent_auth_user_id = authUserId;
    this.agents.set(agentId, { auth_user_id: authUserId, tenant: pair.restaurant!, revoked: false });
    return agentId;
  }
  async snapshot(pairingId: string) { return this.pairings.get(pairingId) ?? null; }
  async fail(pairingId: string) {
    const pair = this.pairings.get(pairingId)!;
    if (pair.status !== "redeeming") throw new Error("unavailable");
    pair.status = "failed";
  }
  async requireOwner(ownerId: string, restaurantId: string) {
    if (ownerId !== owner || restaurantId !== tenantA) throw new Error("owner required");
  }
  async agent(restaurantId: string, agentId: string) {
    const agent = this.agents.get(agentId);
    return agent?.tenant === restaurantId ? { auth_user_id: agent.auth_user_id } : null;
  }
  async revoke(restaurantId: string, agentId: string) {
    const agent = this.agents.get(agentId);
    if (!agent || agent.tenant !== restaurantId) throw new Error("unavailable");
    agent.revoked = true;
  }
  async cancel(pairingId: string, restaurantId: string) {
    const pair = this.pairings.get(pairingId);
    if (!pair || pair.restaurant !== restaurantId ||
      !["approved", "redeeming"].includes(pair.status)) throw new Error("unavailable");
    pair.status = "cancelled";
  }
  async createIdentity(email: string) {
    if (this.createFails) throw new Error("Auth Admin failed");
    if (this.identities.has(email)) throw new Error("duplicate Auth user");
    const id = crypto.randomUUID();
    this.identities.set(email, id); this.created++;
    return id;
  }
  async signIn(): Promise<SessionMaterial> {
    if (this.signInFails) throw new Error("sign-in failed");
    return { accessToken: "agent-access", refreshToken: "agent-refresh", expiresAt: 12345 };
  }
  async deleteIdentity(id: string) {
    if (this.deleteFails) throw new Error("cleanup failed");
    for (const [email, user] of this.identities) {
      if (user === id) { this.identities.delete(email); this.deleted++; return; }
    }
  }
  async isDedicatedIdentity(id: string) { return [...this.identities.values()].includes(id); }
  async banIdentity() { if (this.banFails) throw new Error("ban failed"); this.banned++; }
  async listBridgeIdentities() {
    return [...this.identities].map(([email, id]) => ({ id, email,
      pairingId: email.slice("bridge-".length, "bridge-".length + 36) }));
  }
  async hasAgentForAuth(authUserId: string) {
    return [...this.agents.values()].some((agent) => agent.auth_user_id === authUserId);
  }
  async expire(pairingId: string) { this.pairings.get(pairingId)!.status = "expired"; }
}

async function approved(ports = new MockPorts(), keyring = keys) {
  const proof = generateBridgeProof();
  const { setupToken } = await initiatePairing(ports, keyring, owner, tenantA);
  const challenge = await startPairing(ports, keyring, { bridgeName: "Test Bridge", proof, setupToken });
  await approvePairing(ports, keyring, { pairingId: challenge.pairingId,
    restaurantId: tenantA, code: challenge.code, setupToken }, owner);
  return { ports, proof, challenge };
}

describe("trusted print bridge pairing", () => {
  it("requires an active Owner to initiate and a fresh setup token to start", async () => {
    const ports = new MockPorts();
    await expect(initiatePairing(ports, keys, crypto.randomUUID(), tenantA)).rejects.toThrow();
    await expect(initiatePairing(ports, keys, owner, tenantB)).rejects.toThrow();
    await expect(startPairing(ports, keys,
      { bridgeName: "Bridge", proof: generateBridgeProof() })).rejects.toMatchObject({ code: "INVALID_SETUP" });
    const { setupToken } = await initiatePairing(ports, keys, owner, tenantA);
    await expect(startPairing(ports, keys, { bridgeName: "Bridge",
      proof: generateBridgeProof(), setupToken: `${setupToken}tampered` }))
      .rejects.toMatchObject({ code: "INVALID_SETUP" });
    await startPairing(ports, keys, { bridgeName: "Bridge", proof: generateBridgeProof(), setupToken });
    await expect(startPairing(ports, keys,
      { bridgeName: "Bridge", proof: generateBridgeProof(), setupToken })).rejects.toThrow();
    expect(ports.pairings.size).toBe(1);
  });

  it("expires Owner setup authorization before challenge creation", async () => {
    const ports = new MockPorts();
    const { setupToken } = await initiatePairing(ports, keys, owner, tenantA);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 301_000);
      await expect(startPairing(ports, keys,
        { bridgeName: "Bridge", proof: generateBridgeProof(), setupToken }))
        .rejects.toMatchObject({ code: "INVALID_SETUP" });
      expect(ports.pairings.size).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("binds a high-entropy proof and stores only keyed digests", async () => {
    const { ports, proof, challenge } = await approved();
    const row = ports.pairings.get(challenge.pairingId)!;
    expect(proof).toHaveLength(43);
    expect(challenge.code).toMatch(/^[0-9]{10}$/);
    expect(row.proof).toMatch(/^[0-9a-f]{64}$/);
    expect(row.proof).not.toContain(proof);
    expect(row.code).not.toContain(challenge.code);
  });

  it("denies unauthorized and cross-restaurant approval", async () => {
    const ports = new MockPorts();
    const { setupToken } = await initiatePairing(ports, keys, owner, tenantA);
    const challenge = await startPairing(ports, keys,
      { bridgeName: "Bridge", proof: generateBridgeProof(), setupToken });
    await expect(approvePairing(ports, keys, { pairingId: challenge.pairingId,
      restaurantId: tenantA, code: challenge.code, setupToken }, crypto.randomUUID())).rejects.toThrow();
    await expect(approvePairing(ports, keys, { pairingId: challenge.pairingId,
      restaurantId: tenantB, code: challenge.code, setupToken }, owner)).rejects.toThrow();
    expect(ports.pairings.get(challenge.pairingId)?.status).toBe("pending");
  });

  it("denies invalid, expired and cancelled proof redemption", async () => {
    const { ports, proof, challenge } = await approved();
    await expect(redeemPairing(ports, keys, { pairingId: challenge.pairingId,
      proof: generateBridgeProof() }, "agents.example.com")).rejects.toThrow();
    ports.pairings.get(challenge.pairingId)!.status = "expired";
    await expect(redeemPairing(ports, keys, { pairingId: challenge.pairingId,
      proof }, "agents.example.com")).rejects.toThrow();
    ports.pairings.get(challenge.pairingId)!.status = "approved";
    await cancelPairing(ports, owner, { pairingId: challenge.pairingId, restaurantId: tenantA });
    await expect(redeemPairing(ports, keys, { pairingId: challenge.pairingId,
      proof }, "agents.example.com")).rejects.toThrow();
    expect(ports.created).toBe(0);
  });

  it("serializes concurrent redemption and prevents duplicate Auth users", async () => {
    const { ports, proof, challenge } = await approved();
    const calls = await Promise.allSettled([0, 1].map(() => redeemPairing(ports, keys,
      { pairingId: challenge.pairingId, proof }, "agents.example.com")));
    expect(calls.filter((call) => call.status === "fulfilled")).toHaveLength(1);
    expect(ports.created).toBe(1);
    expect(ports.agents.size).toBe(1);
    expect(ports.pairings.get(challenge.pairingId)?.status).toBe("completed");
  });

  it("does not replay a lost credential response or the original proof", async () => {
    const { ports, proof, challenge } = await approved();
    const first = await redeemPairing(ports, keys, { pairingId: challenge.pairingId,
      proof }, "agents.example.com");
    expect(first.session.refreshToken).toBe("agent-refresh");
    await expect(redeemPairing(ports, keys, { pairingId: challenge.pairingId,
      proof }, "agents.example.com")).rejects.toThrow();
    expect(ports.created).toBe(1);
  });

  it("fails closed and leaves no Auth user after Auth Admin failure", async () => {
    const { ports, proof, challenge } = await approved();
    ports.createFails = true;
    await expect(redeemPairing(ports, keys, { pairingId: challenge.pairingId,
      proof }, "agents.example.com")).rejects.toThrow("start a new pairing");
    expect(ports.pairings.get(challenge.pairingId)?.status).toBe("failed");
    expect(ports.identities.size).toBe(0);
  });

  it("cleans an Auth user when sign-in or agent binding fails", async () => {
    for (const failure of ["signInFails", "completeFails"] as const) {
      const { ports, proof, challenge } = await approved();
      ports[failure] = true;
      await expect(redeemPairing(ports, keys, { pairingId: challenge.pairingId,
        proof }, "agents.example.com")).rejects.toThrow();
      expect(ports.created).toBe(1);
      expect(ports.deleted).toBe(1);
      expect(ports.identities.size).toBe(0);
      expect(ports.pairings.get(challenge.pairingId)?.status).toBe("failed");
    }
  });

  it("leaves a deterministic identifiable orphan when cleanup fails", async () => {
    const { ports, proof, challenge } = await approved();
    ports.completeFails = true; ports.deleteFails = true;
    await expect(redeemPairing(ports, keys, { pairingId: challenge.pairingId,
      proof }, "agents.example.com")).rejects.toThrow();
    expect([...ports.identities.keys()]).toEqual([
      `bridge-${challenge.pairingId}@agents.example.com`,
    ]);
    expect(ports.agents.size).toBe(0);
    expect(ports.pairings.get(challenge.pairingId)?.status).toBe("failed");
    ports.deleteFails = false;
    const cleanup = await reconcileOrphanIdentities(ports, "agents.example.com");
    expect(cleanup.removed).toBe(1);
    expect(ports.identities.size).toBe(0);
  });

  it("reconciles a crash orphan only after expiry and a safety delay", async () => {
    const { ports, challenge } = await approved();
    const email = `bridge-${challenge.pairingId}@agents.example.com`;
    await ports.createIdentity(email);
    ports.pairings.get(challenge.pairingId)!.status = "redeeming";
    expect((await reconcileOrphanIdentities(ports, "agents.example.com")).removed).toBe(0);
    const later = Date.now() + 601_000;
    expect((await reconcileOrphanIdentities(ports, "agents.example.com", later)).removed).toBe(1);
    expect(ports.pairings.get(challenge.pairingId)?.status).toBe("expired");
  });

  it("never cleans a completed bound identity", async () => {
    const { ports, proof, challenge } = await approved();
    await redeemPairing(ports, keys, { pairingId: challenge.pairingId,
      proof }, "agents.example.com");
    const result = await reconcileOrphanIdentities(ports, "agents.example.com",
      Date.now() + 900_000);
    expect(result.removed).toBe(0);
    expect(result.retained).toBe(1);
  });

  it("confirms an ambiguous DB completion before delivering credentials", async () => {
    const { ports, proof, challenge } = await approved();
    const complete = ports.complete.bind(ports);
    ports.complete = async (pairingId, id) => { await complete(pairingId, id); throw new Error("lost DB response"); };
    const result = await redeemPairing(ports, keys, { pairingId: challenge.pairingId,
      proof }, "agents.example.com");
    expect(result.agentId).toBe(ports.pairings.get(challenge.pairingId)?.agent_id);
    expect(ports.deleted).toBe(0);
  });

  it("revokes the DB agent before Auth ban and supports safe re-pair rotation", async () => {
    const { ports, proof, challenge } = await approved();
    const agent = await redeemPairing(ports, keys, { pairingId: challenge.pairingId,
      proof }, "agents.example.com");
    await revokeAgent(ports, owner, { restaurantId: tenantA, agentId: agent.agentId });
    expect(ports.agents.get(agent.agentId)?.revoked).toBe(true);
    expect(ports.banned).toBe(1);
    await expect(revokeAgent(ports, owner,
      { restaurantId: tenantB, agentId: agent.agentId })).rejects.toThrow();
  });

  it("keeps DB revocation authoritative if Auth ban needs retry", async () => {
    const { ports, proof, challenge } = await approved();
    const agent = await redeemPairing(ports, keys, { pairingId: challenge.pairingId,
      proof }, "agents.example.com");
    ports.banFails = true;
    await expect(revokeAgent(ports, owner,
      { restaurantId: tenantA, agentId: agent.agentId })).rejects.toThrow("cleanup requires retry");
    expect(ports.agents.get(agent.agentId)?.revoked).toBe(true);
    ports.banFails = false;
    await revokeAgent(ports, owner, { restaurantId: tenantA, agentId: agent.agentId });
    expect(ports.banned).toBe(1);
  });

  it("fails closed when the Owner cancels during Auth provisioning", async () => {
    const { ports, proof, challenge } = await approved();
    const create = ports.createIdentity.bind(ports);
    ports.createIdentity = async (email) => {
      const id = await create(email);
      await cancelPairing(ports, owner,
        { pairingId: challenge.pairingId, restaurantId: tenantA });
      return id;
    };
    await expect(redeemPairing(ports, keys,
      { pairingId: challenge.pairingId, proof }, "agents.example.com"))
      .rejects.toMatchObject({ code: "PROVISIONING_FAILED" });
    expect(ports.pairings.get(challenge.pairingId)?.status).toBe("cancelled");
    expect(ports.agents.size).toBe(0);
    expect(ports.identities.size).toBe(0);
  });

  it("retains an identity if binding finishes during orphan reconciliation", async () => {
    const { ports, challenge } = await approved();
    const pair = ports.pairings.get(challenge.pairingId)!;
    await ports.beginRedemption(challenge.pairingId, pair.proof);
    const authUserId = await ports.createIdentity(`bridge-${challenge.pairingId}@agents.example.com`);
    const snapshot = ports.snapshot.bind(ports);
    ports.snapshot = async (pairingId) => {
      await ports.complete(pairingId, authUserId);
      return snapshot(pairingId);
    };
    const result = await reconcileOrphanIdentities(ports, "agents.example.com",
      Date.now() + 601_000);
    expect(result.removed).toBe(0);
    expect(ports.identities.size).toBe(1);
    expect(ports.pairings.get(challenge.pairingId)?.status).toBe("completed");
  });

  it("accepts a retained key only during explicit key rotation", async () => {
    const old = keys;
    const { ports, proof, challenge } = await approved(new MockPorts(), old);
    const rotated = parseDigestKeyring(JSON.stringify({ current: "v2",
      keys: { v1: generateBridgeProof(), v2: generateBridgeProof() } }));
    rotated.keys.v1 = old.keys.v1;
    const result = await redeemPairing(ports, rotated,
      { pairingId: challenge.pairingId, proof }, "agents.example.com");
    expect(result.agentId).toBeTruthy();
  });

  it("keeps a consumed setup token in the same replay bucket across key rotation", async () => {
    const ports = new MockPorts();
    const { setupToken } = await initiatePairing(ports, keys, owner, tenantA);
    await startPairing(ports, keys,
      { bridgeName: "Bridge", proof: generateBridgeProof(), setupToken });
    const rotated = parseDigestKeyring(JSON.stringify({ current: "v2",
      keys: { v1: generateBridgeProof(), v2: generateBridgeProof() } }));
    rotated.keys.v1 = keys.keys.v1;
    await expect(startPairing(ports, rotated,
      { bridgeName: "Bridge", proof: generateBridgeProof(), setupToken })).rejects.toThrow();

    const buckets: string[] = [];
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const command = JSON.parse(String(init?.body)) as unknown[];
      buckets.push(String(command[3]));
      return new Response(JSON.stringify({ result: 1 }), { status: 200 });
    }) as typeof fetch;
    const identity = `v1:${setupToken.split(".")[3]}`;
    await upstashRateLimiter("https://redis.example.test", "private-token", keys, fetcher)
      ("setup-token", identity, 1, 600);
    await upstashRateLimiter("https://redis.example.test", "private-token", rotated, fetcher)
      ("setup-token", identity, 1, 600);
    expect(buckets[0]).toBe(buckets[1]);
  });

  it("keeps the durable claim after Redis eviction and serializes concurrent starts", async () => {
    const ports = new MockPorts();
    const { setupToken } = await initiatePairing(ports, keys, owner, tenantA);
    const attempts = await Promise.allSettled([0, 1].map(() => startPairing(ports, keys,
      { bridgeName: "Bridge", proof: generateBridgeProof(), setupToken })));
    expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    ports.rate.clear(); // Redis flush cannot clear PostgreSQL's claim.
    await expect(startPairing(ports, keys,
      { bridgeName: "Bridge", proof: generateBridgeProof(), setupToken }))
      .rejects.toMatchObject({ code: "INVALID_SETUP" });
    expect(ports.pairings.size).toBe(1);
  });

  it("invalid redemption cannot spend another pairing's emergency or pair quota", async () => {
    const { ports, proof, challenge } = await approved();
    for (let index = 0; index < 20; index++) {
      await expect(redeemPairing(ports, keys,
        { pairingId: crypto.randomUUID(), proof: generateBridgeProof() },
        "agents.example.com")).rejects.toMatchObject({ code: "PAIRING_UNAVAILABLE" });
    }
    expect(ports.rate.get("redeem-emergency:all")).toBeUndefined();
    expect(ports.rate.get(`redeem-pair:${challenge.pairingId}`)).toBeUndefined();
    const result = await redeemPairing(ports, keys,
      { pairingId: challenge.pairingId, proof }, "agents.example.com");
    expect(result.agentId).toBeTruthy();
    expect(ports.rate.get("redeem-emergency:all")).toBe(1);
  });

  it("keeps pair quotas independent when clients share a proxy or spoof forwarding headers", async () => {
    const ports = new MockPorts();
    const a = await approved(ports);
    const b = await approved(ports);
    const request = (pairingId: string, proof: string, forwarded: string) =>
      new Request("https://bridge.example.test", { method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": forwarded },
        body: JSON.stringify({ action: "redeem", pairingId, proof }) });
    for (let index = 0; index < 5; index++) {
      await expect(handlePublicBridgeRequest(request(a.challenge.pairingId,
        generateBridgeProof(), `198.51.100.${index}`), ports, keys, "agents.example.com"))
        .rejects.toMatchObject({ code: "PAIRING_UNAVAILABLE" });
    }
    const response = await handlePublicBridgeRequest(request(b.challenge.pairingId,
      b.proof, "198.51.100.1"), ports, keys, "agents.example.com");
    expect(response.status).toBe(200);
    expect(ports.rate.get(`redeem-pair:${b.challenge.pairingId}`)).toBe(1);
    expect([...ports.rate.keys()].some((key) => key.startsWith("bridge-source:"))).toBe(false);
  });

  it("uses an atomic external rate limiter and fails closed when unavailable", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ result: 2 }), { status: 200 }));
    const limit = upstashRateLimiter("https://redis.example.test", "private-token", keys, fetcher);
    await limit("approve-owner", owner, 2, 600);
    await expect(limit("approve-owner", owner, 1, 600)).rejects.toMatchObject({ status: 429 });
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain(owner);
    const broken = upstashRateLimiter("https://redis.example.test", "private-token", keys,
      async () => { throw new Error("network failed"); });
    await expect(broken("start-global", "all", 1, 600)).rejects.toMatchObject({ status: 503 });
  });

  it("keeps source and emergency buckets stable across digest-key rotation", async () => {
    const buckets: string[] = [];
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      buckets.push(String((JSON.parse(String(init?.body)) as unknown[])[3]));
      return new Response(JSON.stringify({ result: 1 }), { status: 200 });
    }) as typeof fetch;
    const stable = crypto.getRandomValues(new Uint8Array(32));
    const rotated = parseDigestKeyring(JSON.stringify({ current: "v2",
      keys: { v1: generateBridgeProof(), v2: generateBridgeProof() } }));
    await upstashRateLimiter("https://redis.example.test", "private-token", keys,
      fetcher, stable)("bridge-source", "192.0.2.7", 120, 600);
    await upstashRateLimiter("https://redis.example.test", "private-token", rotated,
      fetcher, stable)("bridge-source", "192.0.2.7", 120, 600);
    expect(buckets[0]).toBe(buckets[1]);
  });

  it("never places proof, code or credentials in public errors or logs", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { ports, proof, challenge } = await approved();
      ports.createFails = true;
      let message = "";
      try { await redeemPairing(ports, keys, { pairingId: challenge.pairingId,
        proof }, "agents.example.com"); }
      catch (error) { message = String(error); }
      expect(message).not.toContain(proof);
      expect(message).not.toContain(challenge.code);
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
});
