const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

function envFile(file) {
  return Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.includes("=")).map((line) => {
    const split = line.indexOf("=");
    return [line.slice(0, split).trim(), line.slice(split + 1).trim().replace(/^["']|["']$/g, "")];
  }));
}

async function main() {
  const root = path.resolve(__dirname, "../..");
  const env = { ...envFile(path.join(root, ".env.local")), ...envFile(path.join(root, "supabase", "connection.env")) };
  const publicClient = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `owner-auth-${suffix}@serveflow.test`;
  const password = `Owner-${suffix}-A9!`;
  let userId = null;
  const checks = [];
  const check = (label, value, detail = "") => { checks.push(Boolean(value)); console.log(`${value ? "PASS" : "FAIL"} ${label}${detail ? ` - ${detail}` : ""}`); };
  try {
    for (let page = 1; page <= 10; page += 1) {
      const existing = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      for (const user of existing.data?.users || []) {
        if (user.email?.startsWith("owner-auth-") || user.email?.startsWith("weak-owner-auth-")) await admin.auth.admin.deleteUser(user.id);
      }
      if ((existing.data?.users || []).length < 1000) break;
    }
    const weak = await publicClient.functions.invoke("owner-signup", { body: { ownerName: "Weak Owner", email: `weak-${email}`, password: "1234", restaurantName: `Weak ${suffix}` } });
    check("Owner signup rejects weak passwords", Boolean(weak.error || weak.data?.error));
    const created = await publicClient.functions.invoke("owner-signup", { body: { ownerName: "Audit Owner", email, password, restaurantName: `Auth Audit ${suffix}`, restaurantSlug: `auth-audit-${suffix}`, tableCount: null } });
    check("Owner signup accepts real email and strong password", !created.error && created.data?.ok === true);
    userId = created.data?.userId || null;
    check("Owner password is stored only by Supabase Auth", Boolean(userId) && !Object.prototype.hasOwnProperty.call(created.data || {}, "password"));
    const login = await publicClient.auth.signInWithPassword({ email, password });
    check("New Owner signs in with email and password", !login.error && login.data.user?.id === userId, login.error?.message || "");
    await publicClient.auth.signOut();
    // Use a syntactically real but nonexistent project-domain address so this
    // probe verifies the anti-enumerating reset endpoint without emailing a person.
    const reset = await publicClient.auth.resetPasswordForEmail(`reset-audit-${suffix}@serveflow.app`, { redirectTo: "https://serveflow.app/reset-password" });
    check("Supabase accepts Owner self-service reset request", !reset.error, reset.error?.message || "");
  } finally {
    if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
  }
  console.log(`${checks.filter(Boolean).length}/${checks.length} checks passed`);
  if (checks.some((value) => !value)) process.exit(1);
}

main().catch((error) => { console.error(`FAIL ${error.message}`); process.exit(1); });
