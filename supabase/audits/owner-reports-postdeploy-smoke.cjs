const fs = require("node:fs");
const { performance } = require("node:perf_hooks");
const { Client } = require("pg");
const assert = require("node:assert/strict");

const source = fs.readFileSync("supabase/connection.env", "utf8");
const line = source.split(/\r?\n/).find((value) => /^\s*SUPABASE_DB_URL\s*=/.test(value));
assert(line, "SUPABASE_DB_URL is required");
const url = line.replace(/^\s*SUPABASE_DB_URL\s*=\s*/, "").trim().replace(/^["']|["']$/g, "");

async function asUser(db, userId, sql, values) {
  await db.query("begin read only");
  try {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub',$1,true)", [userId]);
    const result = await db.query(sql, values);
    await db.query("rollback");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

async function main() {
  const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const owner = (await db.query("select restaurant_id,user_id from public.restaurant_staff where active and role::text='owner' and user_id is not null order by created_at desc limit 1")).rows[0];
    assert(owner, "An active Owner membership is required for the real-data smoke test");
    for (const [name, collection] of [["inventory", "movements"], ["cashier", "shifts"]]) {
      const functionName = name === "inventory" ? "get_owner_report_inventory_v2" : "get_owner_report_cashier_shifts_v2";
      const started = performance.now();
      const result = (await asUser(db, owner.user_id, `select public.${functionName}($1,'today',null,null,'initial',null,null,50) result`, [owner.restaurant_id])).rows[0].result;
      const sections = name === "inventory" ? ["movements", "requests", "waste"] : ["shifts", "handovers"];
      assert.equal(result.contractVersion, name === "inventory" ? "owner_inventory_report_v2" : "owner_cashier_report_v2");
      assert(result.period && result.summary && result.quality);
      for (const section of sections) assert(Array.isArray(result[section].items) && result[section].items.length <= 50);
      const cursor = result[collection].nextCursor;
      let secondPageRows = 0;
      if (cursor) secondPageRows = (await asUser(db, owner.user_id, `select public.${functionName}($1,'today',null,null,$2,$3,$4,50) result`, [owner.restaurant_id, collection, cursor.at, cursor.id])).rows[0].result[collection].items.length;
      console.log(JSON.stringify({ kind: "realOwnerSmoke", area: name, elapsedMs: +(performance.now() - started).toFixed(2), sections: Object.fromEntries(sections.map((section) => [section, { rows: result[section].items.length, hasNext: Boolean(result[section].nextCursor) }])), secondPageRows, quality: result.quality.state }));
    }
    const checks = [
      ["crossTenantOwner", (await db.query("select user_id from public.restaurant_staff where active and role::text='owner' and restaurant_id<>$1 and user_id is not null limit 1", [owner.restaurant_id])).rows[0]?.user_id, "get_owner_report_inventory_v2"],
      ["manager", (await db.query("select user_id from public.restaurant_staff where active and role::text='manager' and restaurant_id=$1 and user_id is not null limit 1", [owner.restaurant_id])).rows[0]?.user_id, "get_owner_report_cashier_shifts_v2"],
      ["inactiveOwner", (await db.query("select user_id from public.restaurant_staff where not active and role::text='owner' and restaurant_id=$1 and user_id is not null limit 1", [owner.restaurant_id])).rows[0]?.user_id, "get_owner_report_inventory_v2"],
    ];
    for (const [label, userId, functionName] of checks) {
      if (!userId) { console.log(JSON.stringify({ kind: "denial", label, result: "no matching real membership" })); continue; }
      let error;
      try { await asUser(db, userId, `select public.${functionName}($1,'today',null,null,'initial',null,null,50)`, [owner.restaurant_id]); } catch (cause) { error = cause; }
      assert(error && /access is required/i.test(error.message));
      console.log(JSON.stringify({ kind: "denial", label, code: error.code, message: error.message }));
    }
  } finally { await db.end(); }
}
main().catch((error) => { console.error(`FAIL ${error.stack ?? error.message}`); process.exitCode = 1; });
