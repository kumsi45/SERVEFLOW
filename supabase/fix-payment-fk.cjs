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
  const c = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });
  await c.connect();

  // 1. Get the exact constraint definition
  console.log("=== FK Constraint Definition ===");
  const fk = await c.query(`
    SELECT
      tc.constraint_name,
      tc.table_name,
      kcu.column_name,
      ccu.table_name AS foreign_table,
      ccu.column_name AS foreign_column,
      rc.update_rule,
      rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON rc.unique_constraint_name = ccu.constraint_name
    WHERE tc.constraint_name = 'orders_payment_verified_by_same_restaurant'
    ORDER BY kcu.ordinal_position
  `);
  fk.rows.forEach(r => console.log(`  ${r.constraint_name}: ${r.table_name}.${r.column_name} -> ${r.foreign_table}.${r.foreign_column}`));

  // 2. Get the referenced unique constraint
  console.log("\n=== Referenced Unique/PK constraint on restaurant_staff ===");
  const uniq = await c.query(`
    SELECT tc.constraint_name, tc.constraint_type, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_name = 'restaurant_staff'
    AND tc.constraint_type IN ('PRIMARY KEY','UNIQUE')
    ORDER BY tc.constraint_name, kcu.ordinal_position
  `);
  uniq.rows.forEach(r => console.log(`  [${r.constraint_type}] ${r.constraint_name}: ${r.column_name}`));

  // 3. What does approve_order_payment currently do?
  console.log("\n=== approve_order_payment SET lines ===");
  const src = await c.query(`SELECT prosrc FROM pg_proc WHERE proname='approve_order_payment' AND pronamespace='public'::regnamespace`);
  if (src.rows.length > 0) {
    const lines = src.rows[0].prosrc.split('\n').filter(l => l.toLowerCase().includes('payment_verified') || l.toLowerCase().includes('set status') || l.toLowerCase().includes('update public'));
    lines.forEach(l => console.log(' ', l.trim()));
  }

  // 4. Check if the cashier user exists in restaurant_staff
  console.log("\n=== Sample restaurant_staff row to verify composite key ===");
  const sample = await c.query(`SELECT id, restaurant_id, user_id, role, active FROM public.restaurant_staff WHERE role IN ('cashier','owner') LIMIT 3`);
  sample.rows.forEach(r => console.log(`  restaurant_id=${r.restaurant_id} user_id=${r.user_id} role=${r.role} active=${r.active}`));

  await c.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
