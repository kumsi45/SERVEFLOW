const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const { createClient } = require("@supabase/supabase-js");

function envFile(file) {
  return Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.includes("=")).map((line) => {
    const split = line.indexOf("=");
    return [line.slice(0, split).trim(), line.slice(split + 1).trim().replace(/^["']|["']$/g, "")];
  }));
}

function requestWithoutRedirect(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "user-agent": "ServeFlow recovery audit" } }, (response) => {
      response.resume();
      resolve({ status: response.statusCode, location: response.headers.location || null });
    });
    request.setTimeout(30000, () => request.destroy(new Error("Recovery verification timed out.")));
    request.on("error", reject);
  });
}

async function main() {
  const root = path.resolve(__dirname, "../..");
  const env = { ...envFile(path.join(root, ".env.local")), ...envFile(path.join(root, "supabase", "connection.env")) };
  const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `recovery-hosted-${suffix}@serveflow.app`;
  const password = `Recovery-${suffix}-A9!`;
  const requestedRedirect = process.env.RECOVERY_PUBLIC_URL || "https://serveflow.app/reset-password";
  let userId = null;
  let passed = false;
  try {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(created.error?.message || "Could not create recovery audit user.");
    userId = created.data.user.id;
    const generated = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo: requestedRedirect } });
    if (generated.error || !generated.data.properties?.action_link) throw new Error(generated.error?.message || "Could not generate recovery audit link.");
    const response = await requestWithoutRedirect(generated.data.properties.action_link);
    const location = response.location;
    if (!location) throw new Error(`Recovery verification returned ${response.status} without a redirect.`);
    const resolved = new URL(location);
    const safeResolved = `${resolved.origin}${resolved.pathname}`;
    const expected = new URL(requestedRedirect);
    const safeExpected = `${expected.origin}${expected.pathname}`;
    passed = safeResolved === safeExpected;
    console.log(`${passed ? "PASS" : "FAIL"} Hosted recovery redirect resolves to ${safeResolved}`);
  } finally {
    if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
  }
  if (!passed) throw new Error("Hosted recovery redirect does not match the requested trusted route.");
}

main().catch((error) => { console.error(`FAIL ${error.message}`); process.exit(1); });
