const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");
const { createClient } = require("@supabase/supabase-js");

function envFile(file) {
  return Object.fromEntries(
    fs.readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.includes("=")).map((line) => {
      const split = line.indexOf("=");
      return [line.slice(0, split).trim(), line.slice(split + 1).trim().replace(/^["']|["']$/g, "")];
    }),
  );
}

async function waitFor(predicate, message, timeoutMs = 15_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

async function main() {
  const root = path.resolve(__dirname, "../..");
  const env = {
    ...envFile(path.join(root, ".env.local")),
    ...envFile(path.join(root, "supabase", "connection.env")),
  };
  const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const client = () => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const waiterA = client();
  const waiterB = client();
  const db = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  const suffix = crypto.randomUUID().slice(0, 8);
  const restaurantId = crypto.randomUUID();
  const tableA = crypto.randomUUID();
  const tableB = crypto.randomUUID();
  const waiterAStaffId = crypto.randomUUID();
  const waiterBStaffId = crypto.randomUUID();
  const password = `Assistance-${suffix}-A9!`;
  const emails = {
    a: `assistance-a-${suffix}@serveflow.test`,
    b: `assistance-b-${suffix}@serveflow.test`,
  };
  const authIds = [];
  const ids = Object.fromEntries(
    ["pending", "acknowledged", "resolved", "cancelled", "stale", "unassigned"].map((key) => [key, crypto.randomUUID()]),
  );
  const orderIds = Object.fromEntries(Object.keys(ids).map((key) => [key, crypto.randomUUID()]));
  const checks = [];
  const check = (label, value) => checks.push({ label, value: Boolean(value) });

  await db.connect();
  try {
    for (const email of Object.values(emails)) {
      const seeded = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (seeded.error || !seeded.data.user) throw new Error(seeded.error?.message || "Waiter auth seed failed");
      authIds.push(seeded.data.user.id);
    }

    await db.query("insert into restaurants(id,name,slug) values($1,'Assistance Audit',$2)", [restaurantId, `assistance-audit-${suffix}`]);
    await db.query(
      "insert into users(id,restaurant_id,role) values($1,$3,'waiter'),($2,$3,'waiter')",
      [authIds[0], authIds[1], restaurantId],
    );
    await db.query(
      "insert into restaurant_staff(id,restaurant_id,user_id,role,display_name,email,active) values($1,$3,$4,'waiter','Waiter A',$6,true),($2,$3,$5,'waiter','Waiter B',$7,true)",
      [waiterAStaffId, waiterBStaffId, restaurantId, authIds[0], authIds[1], emails.a, emails.b],
    );
    await db.query(
      "insert into restaurant_tables(id,restaurant_id,table_number,label,qr_path,qr_url) values($1,$3,91,'Table 91','/audit/91','https://audit.invalid/91'),($2,$3,92,'Table 92','/audit/92','https://audit.invalid/92')",
      [tableA, tableB, restaurantId],
    );
    await db.query(
      "insert into restaurant_table_waiter_assignments(restaurant_id,table_id,waiter_staff_id,active) values($1,$2,$4,true),($1,$3,$5,true)",
      [restaurantId, tableA, tableB, waiterAStaffId, waiterBStaffId],
    );
    for (const [key, orderId] of Object.entries(orderIds)) {
      const assignedTable = key === "unassigned" ? tableB : tableA;
      const creator = key === "unassigned" ? waiterBStaffId : waiterAStaffId;
      await db.query(
        "insert into orders(id,restaurant_id,status,order_source,dining_session_status,operational_status,workflow_policy_snapshot,table_id,table_number,created_by_waiter_id) values($1,$2,'cancelled','waiter','closed','closed','{}'::jsonb,$3,$4,$5)",
        [orderId, restaurantId, assignedTable, assignedTable === tableA ? "91" : "92", creator],
      );
    }
    const assistanceRows = [
      [ids.pending, orderIds.pending, tableA, waiterAStaffId, "pending", "5 minutes"],
      [ids.acknowledged, orderIds.acknowledged, tableA, waiterAStaffId, "acknowledged", "10 minutes"],
      [ids.resolved, orderIds.resolved, tableA, waiterAStaffId, "resolved", "15 minutes"],
      [ids.cancelled, orderIds.cancelled, tableA, waiterAStaffId, "cancelled", "20 minutes"],
      [ids.stale, orderIds.stale, tableA, waiterAStaffId, "pending", "7 days"],
      [ids.unassigned, orderIds.unassigned, tableB, waiterBStaffId, "pending", "2 minutes"],
    ];
    for (const [id, orderId, tableId, staffId, status, age] of assistanceRows) {
      await db.query(
        "insert into waiter_assistance_requests(id,restaurant_id,order_id,table_id,waiter_staff_id,status,requested_at,resolved_at) values($1,$2,$3,$4,$5,$6,now()-$7::interval,case when $6='resolved' then now() else null end)",
        [id, restaurantId, orderId, tableId, staffId, status, age],
      );
    }

    if ((await waiterA.auth.signInWithPassword({ email: emails.a, password })).error) throw new Error("Waiter A login failed");
    if ((await waiterB.auth.signInWithPassword({ email: emails.b, password })).error) throw new Error("Waiter B login failed");

    const activeA = await waiterA.from("waiter_assistance_requests").select("id,status,requested_at")
      .eq("restaurant_id", restaurantId)
      .in("status", ["pending", "acknowledged"])
      .in("table_id", [tableA])
      .gte("requested_at", new Date(Date.now() - 30 * 60 * 1000).toISOString());
    check("Fresh pending assigned request appears", !activeA.error && activeA.data.some((row) => row.id === ids.pending));
    check("Fresh acknowledged assigned request appears", !activeA.error && activeA.data.some((row) => row.id === ids.acknowledged));
    check("Resolved and cancelled requests do not appear", !activeA.error && !activeA.data.some((row) => [ids.resolved, ids.cancelled].includes(row.id)));
    check("Week-old unresolved request does not appear", !activeA.error && !activeA.data.some((row) => row.id === ids.stale));

    const waiterAVisible = await waiterA.from("waiter_assistance_requests").select("id").eq("restaurant_id", restaurantId);
    check("Another waiter's assigned-table request is hidden by RLS", !waiterAVisible.error && !waiterAVisible.data.some((row) => row.id === ids.unassigned));

    const directUpdate = await waiterA.from("waiter_assistance_requests").update({ status: "resolved" }).eq("id", ids.pending);
    check("Direct waiter update is denied", Boolean(directUpdate.error));

    const unassignedResolve = await waiterA.rpc("resolve_waiter_assistance_request", { target_request_id: ids.unassigned });
    check("Waiter cannot resolve an unassigned-table request", Boolean(unassignedResolve.error));
    const pendingResolve = await waiterA.rpc("resolve_waiter_assistance_request", { target_request_id: ids.pending });
    check("Assigned waiter resolves pending request", !pendingResolve.error && pendingResolve.data?.status === "resolved");
    const acknowledgedResolve = await waiterA.rpc("resolve_waiter_assistance_request", { target_request_id: ids.acknowledged });
    check("Assigned waiter resolves acknowledged request", !acknowledgedResolve.error && acknowledgedResolve.data?.status === "resolved");
    const resolvedConflict = await waiterA.rpc("resolve_waiter_assistance_request", { target_request_id: ids.resolved });
    check("Already-resolved request returns safe conflict", Boolean(resolvedConflict.error) && /no longer active/i.test(resolvedConflict.error.message));
    const cancelledConflict = await waiterA.rpc("resolve_waiter_assistance_request", { target_request_id: ids.cancelled });
    check("Cancelled request returns safe conflict", Boolean(cancelledConflict.error) && /no longer active/i.test(cancelledConflict.error.message));

    const resolvedRows = await db.query(
      "select id,status,resolved_at,resolved_by_staff_id from waiter_assistance_requests where id=any($1)",
      [[ids.pending, ids.acknowledged]],
    );
    check("Resolver staff identity and timestamp are recorded", resolvedRows.rows.length === 2 && resolvedRows.rows.every((row) => row.status === "resolved" && row.resolved_at && row.resolved_by_staff_id === waiterAStaffId));

    const realtimeRequestId = crypto.randomUUID();
    const realtimeEvents = [];
    const channel = waiterA.channel(`assistance-audit-${suffix}`).on(
      "postgres_changes",
      { event: "*", schema: "public", table: "waiter_assistance_requests", filter: `restaurant_id=eq.${restaurantId}` },
      (payload) => realtimeEvents.push(payload),
    );
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Realtime subscription timed out")), 15_000);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          resolve();
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timer);
          reject(new Error(`Realtime subscription failed: ${status}`));
        }
      });
    });
    await db.query(
      "insert into waiter_assistance_requests(id,restaurant_id,order_id,table_id,waiter_staff_id,status,requested_at) values($1,$2,$3,$4,$5,'pending',now())",
      [realtimeRequestId, restaurantId, orderIds.pending, tableA, waiterAStaffId],
    );
    await waitFor(
      () => realtimeEvents.some((event) => event.eventType === "INSERT" && event.new?.id === realtimeRequestId),
      "Realtime assistance creation event was not received",
    );
    check("Realtime assistance creation appears", true);
    const realtimeResolve = await waiterA.rpc("resolve_waiter_assistance_request", { target_request_id: realtimeRequestId });
    if (realtimeResolve.error) throw realtimeResolve.error;
    await waitFor(
      () => realtimeEvents.some((event) => event.eventType === "UPDATE" && event.new?.id === realtimeRequestId && event.new?.status === "resolved"),
      "Realtime assistance resolution event was not received",
    );
    check("Realtime assistance resolution disappears", true);
    await waiterA.removeChannel(channel);

    const realtime = await db.query(
      "select exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='waiter_assistance_requests') published,(select relreplident='f' from pg_class where oid='public.waiter_assistance_requests'::regclass) replica_full",
    );
    check("Existing assistance realtime publication remains active", realtime.rows[0].published && realtime.rows[0].replica_full);
  } finally {
    await Promise.all([waiterA.auth.signOut(), waiterB.auth.signOut()].map((promise) => promise.catch(() => {})));
    await db.query("begin");
    try {
      await db.query("delete from waiter_assistance_requests where restaurant_id=$1", [restaurantId]);
      await db.query("delete from restaurant_table_waiter_assignments where restaurant_id=$1", [restaurantId]);
      await db.query("update orders set created_by_waiter_id=null where restaurant_id=$1", [restaurantId]);
      await db.query("delete from restaurant_staff where restaurant_id=$1", [restaurantId]);
      await db.query("delete from users where restaurant_id=$1", [restaurantId]);
      await db.query("delete from restaurants where id=$1", [restaurantId]);
      await db.query("commit");
    } catch (error) {
      await db.query("rollback");
      throw error;
    }
    for (const id of authIds) await admin.auth.admin.deleteUser(id);
    await db.end();
  }

  for (const result of checks) console.log(`${result.value ? "PASS" : "FAIL"} ${result.label}`);
  if (checks.some((result) => !result.value)) process.exit(1);
}

main().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exit(1);
});
