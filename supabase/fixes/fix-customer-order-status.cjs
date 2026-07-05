const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

function readConnectionUrl() {
  const lines = fs.readFileSync(path.join(__dirname, "connection.env"), "utf8").split(/\r?\n/);
  const line = lines.find((l) => /^\s*SUPABASE_DB_URL\s*=/.test(l));
  if (!line) throw new Error("SUPABASE_DB_URL missing");
  let v = line.replace(/^\s*SUPABASE_DB_URL\s*=\s*/, "").trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v;
}

async function main() {
  const client = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();

  // Get the full function definition
  const r = await client.query(`SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname = 'create_customer_order' AND pronamespace = 'public'::regnamespace`);
  if (r.rows.length === 0) { console.log("create_customer_order not found"); await client.end(); return; }

  const original = r.rows[0].def;
  console.log("Original function found, length:", original.length);

  // Check if it contains 'pending' (not 'pending_payment')
  const hasPending = /[^_]'pending'[^_]/.test(original) || original.includes("'pending'\n") || original.includes("'pending',");
  console.log("Contains status='pending':", hasPending);

  if (!hasPending) {
    console.log("✓ create_customer_order already uses pending_payment, no change needed");
    await client.end();
    return;
  }

  // Replace 'pending' with 'pending_payment' in status assignments only
  const patched = original.replace(/'pending'/g, "'pending_payment'");

  try {
    await client.query("BEGIN");
    await client.query(patched);
    await client.query("COMMIT");
    console.log("✓ create_customer_order patched: status='pending' → status='pending_payment'");
  } catch (e) {
    await client.query("ROLLBACK");
    console.log("Could not auto-patch:", e.message);
    console.log("Manual patch required in Supabase SQL Editor");
  }

  await client.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
