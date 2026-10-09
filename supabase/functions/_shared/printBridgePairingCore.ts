// Pure P3.2 orchestration. The Edge adapters provide privileged I/O.
export class PairingError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
  }
}

export type PairingSnapshot = {
  status: string;
  agent_auth_user_id: string | null;
  agent_id: string | null;
  expires_at?: string;
};
export type SessionMaterial = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};
export type PairingPorts = {
  limit(scope: string, identity: string, maximum: number, windowSeconds: number): Promise<void>;
  begin(codeDigest: string, proofDigest: string, name: string, ttl: number): Promise<string>;
  approve(pairingId: string, codeDigest: string, restaurantId: string, ownerId: string): Promise<void>;
  beginRedemption(pairingId: string, proofDigest: string): Promise<{ restaurant_id: string; bridge_name: string }>;
  complete(pairingId: string, authUserId: string): Promise<string>;
  snapshot(pairingId: string): Promise<PairingSnapshot | null>;
  fail(pairingId: string, code: string): Promise<void>;
  requireOwner(ownerId: string, restaurantId: string): Promise<void>;
  agent(restaurantId: string, agentId: string): Promise<{ auth_user_id: string } | null>;
  revoke(restaurantId: string, agentId: string): Promise<void>;
  cancel(pairingId: string, restaurantId: string): Promise<void>;
  createIdentity(email: string, password: string, pairingId: string, restaurantId: string): Promise<string>;
  signIn(email: string, password: string): Promise<SessionMaterial>;
  deleteIdentity(authUserId: string): Promise<void>;
  isDedicatedIdentity(authUserId: string): Promise<boolean>;
  banIdentity(authUserId: string, replacementPassword: string): Promise<void>;
  listBridgeIdentities(): Promise<Array<{ id: string; pairingId: string; email: string }>>;
  hasAgentForAuth(authUserId: string): Promise<boolean>;
  expire(pairingId: string): Promise<void>;
};

const encoder = new TextEncoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE = /^[0-9]{10}$/;
const PROOF = /^[A-Za-z0-9_-]{43}$/;

export function requireUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new PairingError("INVALID_REQUEST", 400, "Invalid pairing request.");
  }
  return value.toLowerCase();
}

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value: string): Uint8Array {
  if (!PROOF.test(value)) throw new PairingError("INVALID_PROOF", 400, "Invalid pairing proof.");
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const binary = atob(standard + "=");
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    if (bytes.length !== 32 || base64url(bytes) !== value) throw new Error("shape");
    return bytes;
  } catch {
    throw new PairingError("INVALID_PROOF", 400, "Invalid pairing proof.");
  }
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decimalCode(): string {
  let result = "";
  while (result.length < 10) {
    for (const value of randomBytes(16)) {
      if (value < 250) result += String(value % 10);
      if (result.length === 10) break;
    }
  }
  return result;
}

export type DigestKeyring = { current: string; keys: Record<string, Uint8Array> };

export function parseDigestKeyring(raw: string): DigestKeyring {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("Invalid pairing digest key configuration."); }
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid pairing digest key configuration.");
  const value = parsed as { current?: unknown; keys?: unknown };
  if (typeof value.current !== "string" || !/^v[0-9]{1,3}$/.test(value.current) ||
    !value.keys || typeof value.keys !== "object" || Array.isArray(value.keys)) {
    throw new Error("Invalid pairing digest key configuration.");
  }
  const entries = Object.entries(value.keys);
  if (entries.length < 1 || entries.length > 3 ||
    !entries.some(([version]) => version === value.current)) {
    throw new Error("Invalid pairing digest key configuration.");
  }
  const keys: Record<string, Uint8Array> = {};
  for (const [version, encoded] of entries) {
    if (!/^v[0-9]{1,3}$/.test(version) || typeof encoded !== "string") {
      throw new Error("Invalid pairing digest key configuration.");
    }
    try { keys[version] = fromBase64url(encoded); }
    catch { throw new Error("Invalid pairing digest key configuration."); }
  }
  return { current: value.current, keys };
}

export async function digest(
  key: Uint8Array, version: string, purpose: "code" | "proof" | "rate" | "setup", value: string,
): Promise<string> {
  const imported = await crypto.subtle.importKey("raw", new Uint8Array(key).buffer,
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const data = encoder.encode(`serveflow.print-bridge.${version}.${purpose}\0${value}`);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", imported, data)));
}

async function digests(keyring: DigestKeyring, purpose: "code" | "proof", value: string) {
  const order = [keyring.current, ...Object.keys(keyring.keys).filter((item) => item !== keyring.current)];
  return Promise.all(order.map((version) => digest(keyring.keys[version], version, purpose, value)));
}

async function limited(ports: PairingPorts, scope: string, identity: string,
  maximum: number, seconds: number) {
  await ports.limit(scope, identity, maximum, seconds);
}

function equalHex(expected: string, supplied: string): boolean {
  let difference = expected.length ^ supplied.length;
  for (let i = 0; i < expected.length; i++) {
    difference |= expected.charCodeAt(i) ^ (supplied.charCodeAt(i) || 0);
  }
  return difference === 0;
}

async function setupClaims(keys: DigestKeyring, raw: unknown) {
  if (typeof raw !== "string" || raw.length > 300) {
    throw new PairingError("INVALID_SETUP", 403, "Owner setup authorization is unavailable.");
  }
  const [version, ownerId, restaurantId, nonce, expiry, signature, extra] = raw.split(".");
  if (extra || !keys.keys[version] || !UUID.test(ownerId) || !UUID.test(restaurantId) ||
    !PROOF.test(nonce) || !/^[0-9]{13}$/.test(expiry) || !/^[0-9a-f]{64}$/.test(signature)) {
    throw new PairingError("INVALID_SETUP", 403, "Owner setup authorization is unavailable.");
  }
  const expected = await digest(keys.keys[version], version, "setup",
    `${ownerId}.${restaurantId}.${nonce}.${expiry}`);
  if (!equalHex(expected, signature) || Number(expiry) <= Date.now()) {
    throw new PairingError("INVALID_SETUP", 403, "Owner setup authorization is unavailable.");
  }
  return { version, ownerId, restaurantId, nonce };
}

export async function initiatePairing(
  ports: PairingPorts, keys: DigestKeyring, ownerId: string, restaurant: unknown,
) {
  const restaurantId = requireUuid(restaurant);
  await ports.requireOwner(ownerId, restaurantId);
  await limited(ports, "initiate-owner", ownerId, 10, 600);
  const nonce = base64url(randomBytes(32));
  const expiry = String(Date.now() + 300_000);
  const version = keys.current;
  const signature = await digest(keys.keys[version], version, "setup",
    `${ownerId}.${restaurantId}.${nonce}.${expiry}`);
  return { setupToken: `${version}.${ownerId}.${restaurantId}.${nonce}.${expiry}.${signature}`,
    expiresInSeconds: 300, restaurantId };
}

export async function startPairing(
  ports: PairingPorts, keys: DigestKeyring, input: Record<string, unknown>,
) {
  const name = typeof input.bridgeName === "string" ? input.bridgeName.trim() : "";
  if (name.length < 1 || name.length > 120) {
    throw new PairingError("INVALID_REQUEST", 400, "Invalid pairing request.");
  }
  if (typeof input.proof !== "string") throw new PairingError("INVALID_PROOF", 400, "Invalid pairing proof.");
  fromBase64url(input.proof);
  const setup = await setupClaims(keys, input.setupToken);
  await ports.requireOwner(setup.ownerId, setup.restaurantId);
  await limited(ports, "setup-token", `${setup.version}:${setup.nonce}`, 1, 600);
  await limited(ports, "start-global", "all", 300, 3600);
  const fingerprint = await digest(keys.keys[keys.current], keys.current, "rate", input.proof);
  await limited(ports, "start-proof", fingerprint, 3, 600);
  const code = decimalCode();
  const codeDigest = (await digests(keys, "code", code))[0];
  const proofDigest = (await digests(keys, "proof", input.proof))[0];
  const pairingId = await ports.begin(codeDigest, proofDigest, name, 300);
  return { pairingId, code, expiresInSeconds: 300 };
}

export async function approvePairing(
  ports: PairingPorts, keys: DigestKeyring,
  input: Record<string, unknown>, ownerId: string,
) {
  const pairingId = requireUuid(input.pairingId);
  const restaurantId = requireUuid(input.restaurantId);
  const setup = await setupClaims(keys, input.setupToken);
  if (setup.ownerId !== ownerId || setup.restaurantId !== restaurantId) {
    throw new PairingError("INVALID_SETUP", 403, "Owner setup authorization is unavailable.");
  }
  if (typeof input.code !== "string" || !CODE.test(input.code)) {
    throw new PairingError("PAIRING_UNAVAILABLE", 409, "Pairing is unavailable.");
  }
  await ports.requireOwner(ownerId, restaurantId);
  await limited(ports, "approve-owner", ownerId, 20, 600);
  await limited(ports, "approve-pair", pairingId, 5, 600);
  for (const codeDigest of await digests(keys, "code", input.code)) {
    try {
      await ports.approve(pairingId, codeDigest, restaurantId, ownerId);
      return { pairingId, restaurantId };
    } catch { /* old-key probe or unavailable pairing */ }
  }
  throw new PairingError("PAIRING_UNAVAILABLE", 409, "Pairing is unavailable.");
}

export async function redeemPairing(
  ports: PairingPorts, keys: DigestKeyring,
  input: Record<string, unknown>, emailDomain: string,
) {
  const pairingId = requireUuid(input.pairingId);
  if (typeof input.proof !== "string") throw new PairingError("INVALID_PROOF", 400, "Invalid pairing proof.");
  fromBase64url(input.proof);
  if (!/^[a-z0-9.-]{4,160}$/.test(emailDomain) || !emailDomain.includes(".")) {
    throw new Error("Invalid bridge identity email domain.");
  }
  await limited(ports, "redeem-global", "all", 600, 3600);
  await limited(ports, "redeem-pair", pairingId, 5, 600);
  let authorized: { restaurant_id: string; bridge_name: string } | null = null;
  for (const proofDigest of await digests(keys, "proof", input.proof)) {
    try {
      authorized = await ports.beginRedemption(pairingId, proofDigest);
      break;
    } catch { /* old-key probe or unavailable pairing */ }
  }
  if (!authorized) throw new PairingError("PAIRING_UNAVAILABLE", 409, "Pairing is unavailable.");

  const email = `bridge-${pairingId}@${emailDomain}`;
  const password = base64url(randomBytes(48));
  let authUserId: string | null = null;
  let completed = false;
  try {
    authUserId = await ports.createIdentity(email, password, pairingId, authorized.restaurant_id);
    const session = await ports.signIn(email, password);
    let agentId: string;
    try {
      agentId = await ports.complete(pairingId, authUserId);
      completed = true;
    } catch {
      // A timeout can occur after the database committed. Confirm before cleanup.
      const state = await ports.snapshot(pairingId);
      if (state?.status !== "completed" || state.agent_auth_user_id !== authUserId || !state.agent_id) {
        throw new Error("Agent binding could not be confirmed.");
      }
      agentId = state.agent_id;
      completed = true;
    }
    return { pairingId, restaurantId: authorized.restaurant_id, agentId, session };
  } catch {
    let cleanupPending = false;
    if (!completed && authUserId) {
      try { await ports.deleteIdentity(authUserId); }
      catch { cleanupPending = true; /* orphan remains identifiable by pairing ID */ }
    }
    if (!completed) {
      try { await ports.fail(pairingId, cleanupPending ? "AUTH_CLEANUP_PENDING" :
        authUserId ? "AGENT_BINDING_FAILED" : "AUTH_PROVISIONING_FAILED"); }
      catch { /* cancelled, expired, or already completed */ }
    }
    throw new PairingError("PROVISIONING_FAILED", 503, "Bridge provisioning failed; start a new pairing.");
  }
}

export async function revokeAgent(
  ports: PairingPorts, ownerId: string,
  input: Record<string, unknown>,
) {
  const restaurantId = requireUuid(input.restaurantId);
  const agentId = requireUuid(input.agentId);
  await ports.requireOwner(ownerId, restaurantId);
  await limited(ports, "revoke-owner", ownerId, 20, 600);
  const agent = await ports.agent(restaurantId, agentId);
  if (!agent || !(await ports.isDedicatedIdentity(agent.auth_user_id))) {
    throw new PairingError("AGENT_UNAVAILABLE", 404, "Print bridge agent is unavailable.");
  }
  // DB revocation is authoritative even while an old JWT remains unexpired.
  await ports.revoke(restaurantId, agentId);
  try {
    await ports.banIdentity(agent.auth_user_id, base64url(randomBytes(48)));
  } catch {
    throw new PairingError("AUTH_REVOCATION_PENDING", 503,
      "Agent access is revoked; Auth cleanup requires retry.");
  }
  return { restaurantId, agentId, revoked: true };
}

export async function cancelPairing(
  ports: PairingPorts, ownerId: string,
  input: Record<string, unknown>,
) {
  const pairingId = requireUuid(input.pairingId);
  const restaurantId = requireUuid(input.restaurantId);
  await ports.requireOwner(ownerId, restaurantId);
  await limited(ports, "cancel-owner", ownerId, 20, 600);
  try { await ports.cancel(pairingId, restaurantId); }
  catch { throw new PairingError("PAIRING_UNAVAILABLE", 409, "Pairing is unavailable."); }
  return { pairingId, cancelled: true };
}

export function generateBridgeProof(): string { return base64url(randomBytes(32)); }

export async function reconcileOrphanIdentities(
  ports: PairingPorts, emailDomain: string, now = Date.now(),
) {
  let removed = 0;
  let retained = 0;
  const identities = await ports.listBridgeIdentities();
  for (const identity of identities) {
    const pairingId = requireUuid(identity.pairingId);
    if (identity.email !== `bridge-${pairingId}@${emailDomain}` ||
      await ports.hasAgentForAuth(identity.id)) { retained++; continue; }
    const state = await ports.snapshot(pairingId);
    if (!state) { retained++; continue; } // Investigate missing state manually.
    if (state.status === "completed") { retained++; continue; }
    const expired = state.expires_at && Date.parse(state.expires_at) + 300_000 < now;
    if (state.status !== "failed" && state.status !== "cancelled" &&
      state.status !== "expired" && !expired) { retained++; continue; }
    await ports.deleteIdentity(identity.id);
    removed++;
    if (expired && ["pending", "approved", "redeeming"].includes(state.status)) {
      try { await ports.expire(pairingId); } catch { /* concurrent terminal transition */ }
    }
  }
  return { examined: identities.length, removed, retained };
}
