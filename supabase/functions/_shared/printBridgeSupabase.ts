import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PairingError, type PairingPorts, type SessionMaterial } from "./printBridgePairingCore.ts";

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing print bridge backend setting: ${name}`);
  return value;
}

export function printBridgeEnvironment() {
  return {
    url: required("SUPABASE_URL"),
    anon: required("SUPABASE_ANON_KEY"),
    service: required("SUPABASE_SERVICE_ROLE_KEY"),
    keyring: required("PRINT_BRIDGE_DIGEST_KEYS"),
    emailDomain: required("PRINT_BRIDGE_EMAIL_DOMAIN"),
    redisUrl: required("UPSTASH_REDIS_REST_URL"),
    redisToken: required("UPSTASH_REDIS_REST_TOKEN"),
    ownerOrigin: required("PRINT_BRIDGE_OWNER_ORIGIN"),
  };
}

type Config = ReturnType<typeof printBridgeEnvironment>;
const authOptions = { auth: { persistSession: false, autoRefreshToken: false,
  detectSessionInUrl: false } };

function result<T>(value: { data: T | null; error: { message: string } | null }): T {
  if (value.error || value.data === null) throw new Error("Print bridge database operation failed.");
  return value.data;
}

export function createPrintBridgePorts(
  config: Config, limit: PairingPorts["limit"], authorization?: string,
): PairingPorts & { authenticateOwner(): Promise<string> } {
  const service = createClient(config.url, config.service, authOptions);
  const publicAuth = createClient(config.url, config.anon, authOptions);
  const owner = authorization ? createClient(config.url, config.anon, {
    ...authOptions, global: { headers: { Authorization: authorization } },
  }) : null;
  const ownerClient = (): SupabaseClient => {
    if (!owner) throw new PairingError("UNAUTHORIZED", 401, "Owner authentication required.");
    return owner;
  };
  return {
    limit,
    async authenticateOwner() {
      if (!authorization?.startsWith("Bearer ")) {
        throw new PairingError("UNAUTHORIZED", 401, "Owner authentication required.");
      }
      const { data, error } = await ownerClient().auth.getUser(authorization.slice(7));
      if (error || !data.user) throw new PairingError("UNAUTHORIZED", 401, "Owner authentication required.");
      return data.user.id;
    },
    async begin(codeDigest, proofDigest, name, ttl) {
      return result((await service.rpc("begin_print_bridge_pairing", {
        requested_code_digest: `\\x${codeDigest}`,
        requested_proof_digest: `\\x${proofDigest}`,
        requested_bridge_name: name,
        requested_ttl_seconds: ttl,
      })) as { data: string | null; error: { message: string } | null });
    },
    async approve(pairingId, codeDigest, restaurantId, ownerId) {
      result((await service.rpc("approve_print_bridge_pairing", {
        target_pairing_id: pairingId, supplied_code_digest: `\\x${codeDigest}`,
        target_restaurant_id: restaurantId, verified_owner_user_id: ownerId,
      })) as { data: string | null; error: { message: string } | null });
    },
    async beginRedemption(pairingId, proofDigest) {
      const rows = result((await service.rpc("begin_print_bridge_redemption", {
        target_pairing_id: pairingId, supplied_proof_digest: `\\x${proofDigest}`,
      })) as { data: Array<{ restaurant_id: string; bridge_name: string }> | null;
        error: { message: string } | null });
      if (rows.length !== 1) throw new Error("Pairing redemption did not return one tenant.");
      return rows[0];
    },
    async complete(pairingId, authUserId) {
      return result((await service.rpc("complete_print_bridge_redemption", {
        target_pairing_id: pairingId, target_auth_user_id: authUserId,
      })) as { data: string | null; error: { message: string } | null });
    },
    async snapshot(pairingId) {
      const { data, error } = await service.from("print_bridge_pairings")
        .select("status,agent_auth_user_id,agent_id,expires_at").eq("id", pairingId).maybeSingle();
      if (error) throw new Error("Pairing state could not be confirmed.");
      return data;
    },
    async fail(pairingId, code) {
      const { error } = await service.rpc("fail_print_bridge_redemption", {
        target_pairing_id: pairingId, reported_code: code,
      });
      if (error) throw new Error("Pairing failure could not be recorded.");
    },
    async requireOwner(ownerId, restaurantId) {
      const { data, error } = await service.from("restaurant_staff").select("id")
        .eq("restaurant_id", restaurantId).eq("user_id", ownerId)
        .eq("role", "owner").eq("active", true).maybeSingle();
      if (error || !data) {
        throw new PairingError("OWNER_REQUIRED", 403, "Active restaurant Owner required.");
      }
    },
    async agent(restaurantId, agentId) {
      const { data, error } = await service.from("print_agents")
        .select("auth_user_id").eq("restaurant_id", restaurantId)
        .eq("id", agentId).maybeSingle();
      if (error) throw new Error("Print bridge agent lookup failed.");
      return data;
    },
    async revoke(restaurantId, agentId) {
      const { error } = await ownerClient().rpc("owner_revoke_print_agent", {
        target_restaurant_id: restaurantId, target_agent_id: agentId,
      });
      if (error) throw new Error("Print bridge revocation failed.");
    },
    async cancel(pairingId, restaurantId) {
      const { error } = await ownerClient().rpc("cancel_print_bridge_pairing", {
        target_pairing_id: pairingId, target_restaurant_id: restaurantId,
      });
      if (error) throw new Error("Print bridge cancellation failed.");
    },
    async createIdentity(email, password, pairingId, restaurantId) {
      const { data, error } = await service.auth.admin.createUser({
        email, password, email_confirm: true,
        app_metadata: { serveflow_kind: "print_bridge", pairing_id: pairingId,
          restaurant_id: restaurantId },
      });
      if (error || !data.user) throw new Error("Dedicated Auth identity creation failed.");
      return data.user.id;
    },
    async signIn(email, password): Promise<SessionMaterial> {
      const { data, error } = await publicAuth.auth.signInWithPassword({ email, password });
      if (error || !data.session) throw new Error("Dedicated agent sign-in failed.");
      return { accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at ?? 0 };
    },
    async deleteIdentity(authUserId) {
      const { error } = await service.auth.admin.deleteUser(authUserId);
      if (error) throw new Error("Orphan Auth identity cleanup failed.");
    },
    async isDedicatedIdentity(authUserId) {
      const { data, error } = await service.auth.admin.getUserById(authUserId);
      if (error || !data.user) throw new Error("Dedicated Auth identity lookup failed.");
      return data.user.app_metadata?.serveflow_kind === "print_bridge";
    },
    async banIdentity(authUserId, replacementPassword) {
      const { error } = await service.auth.admin.updateUserById(authUserId, {
        ban_duration: "876000h", password: replacementPassword,
      });
      if (error) throw new Error("Dedicated Auth identity ban failed.");
    },
    async listBridgeIdentities() {
      const found: Array<{ id: string; pairingId: string; email: string }> = [];
      for (let page = 1; page <= 100; page++) {
        const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
        if (error || !data) throw new Error("Dedicated identity audit failed.");
        for (const user of data.users) {
          if (user.app_metadata?.serveflow_kind === "print_bridge" &&
            typeof user.app_metadata.pairing_id === "string" && user.email) {
            found.push({ id: user.id, pairingId: user.app_metadata.pairing_id,
              email: user.email });
          }
        }
        if (data.users.length < 1000) return found;
      }
      throw new Error("Dedicated identity audit page limit exceeded.");
    },
    async hasAgentForAuth(authUserId) {
      const { data, error } = await service.from("print_agents")
        .select("id").eq("auth_user_id", authUserId).maybeSingle();
      if (error) throw new Error("Dedicated identity binding audit failed.");
      return Boolean(data);
    },
    async expire(pairingId) {
      const { error } = await service.rpc("expire_print_bridge_pairing", {
        target_pairing_id: pairingId,
      });
      if (error) throw new Error("Pairing expiry could not be recorded.");
    },
  };
}
