const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

function readConnectionUrl() {
  const lines = fs.readFileSync(path.join(__dirname, "connection.env"), "utf8").split(/\r?\n/);
  const line = lines.find((l) => /^\s*SUPABASE_DB_URL\s*=/.test(l));
  if (!line) throw new Error("SUPABASE_DB_URL missing");
  let v = line.replace(/^\s*SUPABASE_DB_URL\s*=\s*/, "").trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1,-1);
  return v;
}

async function main() {
  const client = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();

  // 1. Enum types related to order status
  console.log("\n=== ENUM TYPES ===");
  const enums = await client.query(`
    SELECT t.typname, e.enumlabel
    FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname ILIKE '%order%' OR t.typname ILIKE '%status%'
    ORDER BY t.typname, e.enumsortorder
  `);
  if (enums.rows.length === 0) console.log("No enum types found for order/status");
  else enums.rows.forEach(r => console.log(`  [${r.typname}] ${r.enumlabel}`));

  // 2. Check if orders.status is an enum or text
  console.log("\n=== orders.status column type ===");
  const col = await client.query(`
    SELECT column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'status'
  `);
  col.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type} (udt: ${r.udt_name})`));

  // 3. RPC source for all 3 order-changing functions
  const rpcs = ["approve_order_payment","start_order_preparation","mark_order_ready"];
  for (const name of rpcs) {
    console.log(`\n=== RPC: ${name} ===`);
    const r = await client.query(`SELECT prosrc FROM pg_proc WHERE proname = $1 AND pronamespace = 'public'::regnamespace`, [name]);
    if (r.rows.length === 0) { console.log("  NOT FOUND"); continue; }
    const src = r.rows[0].prosrc;
    // Extract status assignments and checks
    const setMatches = [...src.matchAll(/status\s*=\s*'([^']+)'/gi)].map(m => m[1]);
    const inMatches  = [...src.matchAll(/IN\s*\(\s*('[^)]+)\)/gi)].map(m => m[1]);
    const ifMatches  = [...src.matchAll(/status\s*!=?\s*'([^']+)'/gi)].map(m => m[1]);
    console.log("  Sets status to:", setMatches.length > 0 ? setMatches : "none found in text");
    console.log("  Checks IN:", inMatches.length > 0 ? inMatches : "none");
    console.log("  Checks != :", ifMatches.length > 0 ? ifMatches : "none");
  }

  // 4. All distinct statuses actually in the orders table
  console.log("\n=== ACTUAL STATUS VALUES IN orders TABLE ===");
  const actual = await client.query(`SELECT status, count(*) FROM public.orders GROUP BY status ORDER BY count DESC`);
  actual.rows.forEach(r => console.log(`  ${r.status}: ${r.count} rows`));

  // 5. Check if there is a check constraint on status
  console.log("\n=== CHECK CONSTRAINTS on orders.status ===");
  const cc = await client.query(`
    SELECT cc.constraint_name, cc.check_clause
    FROM information_schema.check_constraints cc
    JOIN information_schema.constraint_column_usage cu ON cc.constraint_name = cu.constraint_name
    WHERE cu.table_schema = 'public' AND cu.table_name = 'orders' AND cu.column_name = 'status'
  `);
  if (cc.rows.length === 0) console.log("  No check constraints found");
  else cc.rows.forEach(r => console.log(`  [${r.constraint_name}] ${r.check_clause}`));

  await client.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
