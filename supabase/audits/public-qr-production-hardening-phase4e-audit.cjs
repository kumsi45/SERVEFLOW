const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const { Client } = require("pg");

const supabaseRoot = path.join(__dirname, "..");
const sourceRoot = path.join(supabaseRoot, "..");

function readKeyValueFile(filePath) {
  return Object.fromEntries(
    fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trim().startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")];
      })
  );
}

function readConnectionUrl() {
  const env = readKeyValueFile(path.join(supabaseRoot, "connection.env"));
  if (!env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL missing from supabase/connection.env");
  return env.SUPABASE_DB_URL;
}

function uuid(label) {
  const hex = crypto.createHash("sha256").update(`serveflow-public-qr-phase4e-${label}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function result(label, ok, detail = "") {
  return { label, ok, detail };
}

function normalizePath(value) {
  try {
    const parsed = new URL(value, "http://serveflow.local");
    return {
      pathname: parsed.pathname,
      tableNumber: parsed.searchParams.get("t") || parsed.searchParams.get("table") || "",
      qrToken: parsed.searchParams.get("qr") || "",
    };
  } catch {
    return { pathname: "", tableNumber: "", qrToken: "" };
  }
}

function qrMatchesTable(row, field) {
  const parsed = normalizePath(row[field]);
  return parsed.pathname === `/r/${row.slug}`
    && parsed.tableNumber === String(row.table_number)
    && parsed.qrToken === String(row.qr_token);
}

async function asRole(client, role, userId, sql, params = []) {
  await client.query("begin");
  try {
    await client.query("set local row_security = on");
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claim.role', $1, true)", [role]);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
    const queryResult = await client.query(sql, params);
    await client.query("commit");
    return queryResult;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function runAsRoleSession(client, role, userId, action) {
  await client.query("reset role");
  await client.query(`set role ${role}`);
  await client.query("select set_config('request.jwt.claim.role', $1, false)", [role]);
  await client.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  try {
    return await action();
  } finally {
    await client.query("reset role");
    await client.query("select set_config('request.jwt.claim.role', '', false)");
    await client.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

async function expectReject(label, action, pattern) {
  try {
    await action();
    return result(label, false, "unexpected success");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return result(label, pattern.test(message), message);
  }
}

async function cleanup(client, ids) {
  const restaurants = [ids.restaurantA, ids.restaurantB];
  await client.query("delete from public.restaurant_table_qr_scans where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.kitchen_order_station_progress where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.order_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.order_invoices where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.staff_activity_log where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.shift_activity_logs where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.cash_reconciliations where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.cashier_shifts where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.orders where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_tables where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.menu_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.categories where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_staff where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.kitchen_stations where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurants where id = any($1::uuid[]) or slug like 'phase4e-public-qr-%'", [restaurants]).catch(() => {});
  await client.query("delete from auth.users where email like 'phase4e-public-qr-%@example.test'").catch(() => {});
}

async function startRealtimeProbe(restaurantId) {
  const envPath = path.join(sourceRoot, ".env.local");
  if (!fs.existsSync(envPath)) {
    return { events: [], ready: false, detail: ".env.local missing", stop: async () => {} };
  }

  const appEnv = readKeyValueFile(envPath);
  const supabaseUrl = appEnv.VITE_SUPABASE_URL;
  const serviceRoleKey = appEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return { events: [], ready: false, detail: "Supabase URL or service role key missing", stop: async () => {} };
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const events = [];
  const channel = supabase.channel(`phase4e-public-qr-${Date.now()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` }, (payload) => events.push({ table: "orders", event: payload.eventType }))
    .on("postgres_changes", { event: "*", schema: "public", table: "order_items", filter: `restaurant_id=eq.${restaurantId}` }, (payload) => events.push({ table: "order_items", event: payload.eventType }))
    .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_tables", filter: `restaurant_id=eq.${restaurantId}` }, (payload) => events.push({ table: "restaurant_tables", event: payload.eventType }));

  const ready = await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 6000);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timeout);
        resolve(true);
      }
    });
  });

  return {
    events,
    ready,
    detail: ready ? "subscribed" : "subscription timeout",
    stop: async () => {
      await Promise.race([
        supabase.removeChannel(channel),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    },
  };
}

async function waitForRealtime(events) {
  const start = Date.now();
  while (Date.now() - start < 9000) {
    const tables = new Set(events.map((event) => event.table));
    if (tables.has("orders") && tables.has("order_items")) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function auditLiveTables(client, results) {
  const liveTables = await client.query(`
    select
      rt.id,
      rt.restaurant_id,
      r.slug,
      rt.table_number,
      rt.qr_token,
      rt.qr_path,
      rt.qr_url,
      rt.active,
      rt.created_at,
      rt.qr_created_at,
      rt.qr_regenerated_at
    from public.restaurant_tables rt
    join public.restaurants r on r.id = rt.restaurant_id
    where rt.active = true
    order by r.slug, rt.table_number
  `);

  results.push(result(
    "Every active table has required QR lifecycle fields",
    liveTables.rows.length > 0
      && liveTables.rows.every((row) => row.restaurant_id && row.table_number && row.qr_token && row.qr_path && row.qr_url && row.created_at),
    `active_tables=${liveTables.rows.length}`
  ));

  results.push(result(
    "Every active table QR path and URL include slug, table number, and QR token",
    liveTables.rows.every((row) => qrMatchesTable(row, "qr_path") && qrMatchesTable(row, "qr_url")),
    JSON.stringify(liveTables.rows.filter((row) => !qrMatchesTable(row, "qr_path") || !qrMatchesTable(row, "qr_url")).slice(0, 10))
  ));

  const duplicates = await client.query(`
    select 'table_number' as check_name, restaurant_id::text || ':' || table_number::text as value, count(*)::int as count
    from public.restaurant_tables
    where active = true
    group by restaurant_id, table_number
    having count(*) > 1
    union all
    select 'qr_token', qr_token::text, count(*)::int
    from public.restaurant_tables
    group by qr_token
    having count(*) > 1
  `);
  results.push(result(
    "No active table number duplicates and no QR token duplicates",
    duplicates.rowCount === 0,
    JSON.stringify(duplicates.rows)
  ));

  const restaurants = [...new Set(liveTables.rows.map((row) => row.slug))];
  const menuChecks = [];
  for (const slug of restaurants) {
    const menu = await asRole(client, "anon", null, "select public.get_public_qr_menu($1) as menu", [slug]);
    const payload = menu.rows[0]?.menu;
    menuChecks.push({
      slug,
      ok: Boolean(payload?.restaurant?.slug === slug && Array.isArray(payload.categories) && Array.isArray(payload.items) && Array.isArray(payload.tables)),
      categories: payload?.categories?.length ?? 0,
      items: payload?.items?.length ?? 0,
      tables: payload?.tables?.length ?? 0,
    });
  }
  results.push(result(
    "Every active-table restaurant menu RPC opens consistently",
    menuChecks.every((row) => row.ok),
    JSON.stringify(menuChecks)
  ));

  const invalidSessionRows = [];
  for (const row of liveTables.rows) {
    try {
      await asRole(
        client,
        "anon",
        null,
        "select public.get_public_qr_order_session($1, $2, $3) as session",
        [row.slug, String(row.table_number), String(row.qr_token)]
      );
    } catch (error) {
      invalidSessionRows.push({ slug: row.slug, table_number: row.table_number, error: error.message });
    }
  }
  results.push(result(
    "Every active live table passes QR session validation",
    invalidSessionRows.length === 0,
    JSON.stringify(invalidSessionRows.slice(0, 10))
  ));

  const realtimePublication = await client.query(`
    select tablename
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = any($1::text[])
    order by tablename
  `, [["orders", "order_items", "restaurant_tables"]]);
  results.push(result(
    "Realtime publication includes public QR lifecycle tables",
    ["order_items", "orders", "restaurant_tables"].every((name) => realtimePublication.rows.some((row) => row.tablename === name)),
    JSON.stringify(realtimePublication.rows)
  ));
}

async function auditSource(results) {
  const qrContext = fs.readFileSync(path.join(sourceRoot, "src", "modules", "public-qr-ordering", "services", "publicQrContext.ts"), "utf8");
  const checkoutHook = fs.readFileSync(path.join(sourceRoot, "src", "modules", "public-qr-ordering", "hooks", "usePublicQrCheckoutState.ts"), "utf8");
  const qrMenuPage = fs.readFileSync(path.join(sourceRoot, "src", "modules", "qr-menu", "pages", "QRMenuPage.tsx"), "utf8");
  const orderingPage = fs.readFileSync(path.join(sourceRoot, "src", "modules", "ordering", "pages", "OrderingPage.tsx"), "utf8");
  const publicOrderService = fs.readFileSync(path.join(sourceRoot, "src", "modules", "public-qr-ordering", "services", "publicQrOrderService.ts"), "utf8");
  const legacyOrderService = fs.readFileSync(path.join(sourceRoot, "src", "modules", "ordering", "services", "orderingService.ts"), "utf8");

  results.push(result(
    "Frontend treats the current scanned QR URL as the only public QR context source",
    qrContext.includes("serveflow.publicQrActiveSessionKey")
      && qrContext.includes("clearPublicQrStorageForNewSession")
      && qrContext.includes("buildPublicQrSessionKey")
      && !qrContext.includes('source: "stored"')
      && !qrContext.includes("readStoredQrContext")
      && checkoutHook.includes("readPublicQrContext")
      && checkoutHook.includes("qrContext.sessionKey")
      && qrMenuPage.includes("currentSessionKeyRef")
      && orderingPage.includes("currentSessionKeyRef")
      && orderingPage.includes("readPublicQrContext")
      && orderingPage.includes("buildPublicQrContextUrl"),
    "QR context is centralized, URL-driven, session-keyed, and QR changes purge stale public state."
  ));

  results.push(result(
    "Every create_public_qr_order frontend payload includes qr_token",
    publicOrderService.includes("qr_token: qrToken ?? \"\"")
      && legacyOrderService.includes("qr_token: qrToken")
      && qrMenuPage.includes("qrToken: checkout.qrToken")
      && orderingPage.includes("qrToken: qrParams.qrToken"),
    "Both public ordering entry points submit the restored QR token."
  ));

  results.push(result(
    "No public QR submit path bypasses the shared QR context",
    !checkoutHook.includes("params.get(\"qr\")")
      && !qrMenuPage.includes("new URLSearchParams(window.location.search)")
      && !orderingPage.includes("new URLSearchParams(window.location.search)"),
    "Only publicQrContext.ts reads the qr URL parameter."
  ));
}

async function auditSyntheticLifecycle(client, ids, results) {
  await cleanup(client, ids);

  await client.query(`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values
      ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase4e-public-qr-owner-a@example.test', '', now(), now(), now()),
      ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase4e-public-qr-owner-b@example.test', '', now(), now(), now()),
      ($3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase4e-public-qr-cashier-a@example.test', '', now(), now(), now())
  `, [ids.ownerA, ids.ownerB, ids.cashierA]);

  await client.query(`
    insert into public.restaurants (id, name, slug, total_tables, table_count)
    values
      ($1, 'Phase 4E Public QR A', 'phase4e-public-qr-a', 20, 20),
      ($2, 'Phase 4E Public QR B', 'phase4e-public-qr-b', 20, 20)
  `, [ids.restaurantA, ids.restaurantB]);

  await client.query(`
    insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active)
    values
      ($1, $4, $6, 'owner', 'Phase 4E Owner A', 'phase4e-public-qr-owner-a@example.test', true),
      ($2, $5, $7, 'owner', 'Phase 4E Owner B', 'phase4e-public-qr-owner-b@example.test', true),
      ($3, $4, $8, 'cashier', 'Phase 4E Cashier A', 'phase4e-public-qr-cashier-a@example.test', true)
  `, [ids.staffOwnerA, ids.staffOwnerB, ids.staffCashierA, ids.restaurantA, ids.restaurantB, ids.ownerA, ids.ownerB, ids.cashierA]);

  await client.query(`
    insert into public.kitchen_stations (id, restaurant_id, name, priority, active)
    values
      ($1, $3, 'Main Kitchen', 1, true),
      ($2, $4, 'Main Kitchen', 1, true)
  `, [ids.stationA, ids.stationB, ids.restaurantA, ids.restaurantB]);

  await client.query(`
    insert into public.categories (id, restaurant_id, name)
    values
      ($1, $3, 'Main Menu'),
      ($2, $4, 'Main Menu')
  `, [ids.categoryA, ids.categoryB, ids.restaurantA, ids.restaurantB]);

  await client.query(`
    insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id)
    values
      ($1, $5, $7, 'Burger', 550, true, $9),
      ($2, $5, $7, 'Coke', 100, true, $9),
      ($3, $5, $7, 'Dessert', 175, true, $9),
      ($4, $6, $8, 'Tenant Burger', 10, true, $10)
  `, [ids.burger, ids.coke, ids.dessert, ids.tenantItem, ids.restaurantA, ids.restaurantB, ids.categoryA, ids.categoryB, ids.stationA, ids.stationB]);

  const generatedTables = await asRole(
    client,
    "authenticated",
    ids.ownerA,
    "select id, restaurant_id, table_number, qr_token, qr_path, qr_url, active, created_at from public.sync_restaurant_tables($1, 20) order by table_number",
    [ids.restaurantA]
  );

  results.push(result(
    "20-table restaurant launch creates identical active QR rows",
    generatedTables.rowCount === 20
      && generatedTables.rows.every((row, index) => row.table_number === index + 1 && row.active === true && row.qr_token && row.qr_path && row.qr_url),
    JSON.stringify(generatedTables.rows.map((row) => ({ table_number: row.table_number, qr_path: row.qr_path })).slice(0, 5))
  ));

  results.push(result(
    "Generated test QR rows use unique tokens and correct URL components",
    new Set(generatedTables.rows.map((row) => row.qr_token)).size === 20
      && generatedTables.rows.every((row) => qrMatchesTable({ ...row, slug: "phase4e-public-qr-a" }, "qr_path"))
      && generatedTables.rows.every((row) => qrMatchesTable({ ...row, slug: "phase4e-public-qr-a" }, "qr_url")),
    JSON.stringify(generatedTables.rows.map((row) => ({ table_number: row.table_number, qr_token: row.qr_token })).slice(0, 5))
  ));

  const tableResults = [];
  let realtimeProbe = await startRealtimeProbe(ids.restaurantA);
  try {
    const menu = await asRole(client, "anon", null, "select public.get_public_qr_menu($1) as menu", ["phase4e-public-qr-a"]);
    const menuOk = Boolean(
      menu.rows[0].menu?.restaurant?.slug === "phase4e-public-qr-a"
        && Array.isArray(menu.rows[0].menu?.categories)
        && Array.isArray(menu.rows[0].menu?.items)
    );

    await runAsRoleSession(client, "anon", null, async () => {
      for (const table of generatedTables.rows) {
        console.log(`Testing Table ${table.table_number}...`);
        const sessionBefore = await client.query(
          "select public.get_public_qr_order_session($1, $2, $3) as session",
          ["phase4e-public-qr-a", String(table.table_number), String(table.qr_token)]
        );
        const first = await client.query(
          "select public.create_public_qr_order($1, $2, $3, 'Phase4E Guest', 'Cash', $4::jsonb) as payload",
          ["phase4e-public-qr-a", String(table.table_number), String(table.qr_token), JSON.stringify([{ menu_item_id: ids.burger, quantity: 1 }])]
        );
        const second = await client.query(
          "select public.create_public_qr_order($1, $2, $3, 'Phase4E Guest', 'Cash', $4::jsonb) as payload",
          ["phase4e-public-qr-a", String(table.table_number), String(table.qr_token), JSON.stringify([{ menu_item_id: ids.coke, quantity: 1 }])]
        );
        const activeOrderId = first.rows[0].payload.order_id;
        const appendedOrderId = second.rows[0].payload.order_id;

        await client.query("reset role");
        const orderRows = await client.query(`
          select count(*)::int as order_count, sum(total_price)::numeric as total
          from public.orders
          where restaurant_id = $1 and table_number = $2 and status::text in ('pending_payment', 'paid', 'preparing', 'ready')
        `, [ids.restaurantA, String(table.table_number)]);

        const itemRows = await client.query(`
          select menu_items.name, count(*)::int as rows, sum(order_items.quantity)::int as quantity
          from public.order_items
          join public.menu_items on menu_items.restaurant_id = order_items.restaurant_id and menu_items.id = order_items.menu_item_id
          where order_items.restaurant_id = $1 and order_items.order_id = $2
          group by menu_items.name
          order by menu_items.name
        `, [ids.restaurantA, activeOrderId]);

        await client.query(`set role anon`);
        await client.query("select set_config('request.jwt.claim.role', 'anon', false)");
        await client.query("select set_config('request.jwt.claim.sub', '', false)");
        const sessionAfter = await client.query(
          "select public.get_public_qr_order_session($1, $2, $3) as session",
          ["phase4e-public-qr-a", String(table.table_number), String(table.qr_token)]
        );

        await client.query("reset role");
        await client.query(
          "update public.orders set status = 'completed', completed_at = now(), completed_by = $3, updated_at = now() where id = $1 and restaurant_id = $2",
          [activeOrderId, ids.restaurantA, ids.staffCashierA]
        );

        await client.query(`set role anon`);
        await client.query("select set_config('request.jwt.claim.role', 'anon', false)");
        await client.query("select set_config('request.jwt.claim.sub', '', false)");
        const third = await client.query(
          "select public.create_public_qr_order($1, $2, $3, 'Phase4E New Guest', 'Cash', $4::jsonb) as payload",
          ["phase4e-public-qr-a", String(table.table_number), String(table.qr_token), JSON.stringify([{ menu_item_id: ids.dessert, quantity: 1 }])]
        );

        tableResults.push({
          table_number: table.table_number,
          ok: Boolean(
            menuOk
              && sessionBefore.rows[0].session === null
              && first.rows[0].payload.session_action === "created"
              && second.rows[0].payload.session_action === "appended"
              && activeOrderId === appendedOrderId
              && Number(orderRows.rows[0].order_count) === 1
              && itemRows.rows.length === 2
              && itemRows.rows.some((row) => row.name === "Burger" && row.quantity === 1)
              && itemRows.rows.some((row) => row.name === "Coke" && row.quantity === 1)
              && sessionAfter.rows[0].session?.order_id === activeOrderId
              && third.rows[0].payload.order_id !== activeOrderId
              && third.rows[0].payload.session_action === "created"
          ),
        });
      }
    });

    const realtimeReceived = realtimeProbe.ready ? await waitForRealtime(realtimeProbe.events) : false;
    results.push(result(
      "Realtime publishes public QR order lifecycle events",
      realtimeProbe.ready && realtimeReceived,
      JSON.stringify({ ready: realtimeProbe.ready, detail: realtimeProbe.detail, events: realtimeProbe.events })
    ));
  } finally {
    await realtimeProbe.stop();
  }

  results.push(result(
    "Tables 1 through 20 all pass menu, order, append, duplicate prevention, session close, and new session checks",
    tableResults.length === 20 && tableResults.every((row) => row.ok),
    JSON.stringify(tableResults)
  ));

  const finalOrderShape = await client.query(`
    select table_number, count(*)::int as orders
    from public.orders
    where restaurant_id = $1
    group by table_number
    order by table_number::int
  `, [ids.restaurantA]);
  results.push(result(
    "Every tested table behaved identically",
    finalOrderShape.rowCount === 20 && finalOrderShape.rows.every((row) => row.orders === 2),
    JSON.stringify(finalOrderShape.rows)
  ));

  const originalTableOne = generatedTables.rows.find((row) => row.table_number === 1);
  const regenerated = await asRole(
    client,
    "authenticated",
    ids.ownerA,
    "select id, table_number, qr_token, qr_path, qr_url from public.regenerate_all_restaurant_table_qr($1) order by table_number",
    [ids.restaurantA]
  );
  results.push(result(
    "QR regeneration preserves table IDs and rotates QR tokens",
    regenerated.rowCount === 20
      && regenerated.rows.find((row) => row.table_number === 1)?.id === originalTableOne.id
      && regenerated.rows.find((row) => row.table_number === 1)?.qr_token !== originalTableOne.qr_token
      && regenerated.rows.every((row) => qrMatchesTable({ ...row, slug: "phase4e-public-qr-a" }, "qr_path"))
      && regenerated.rows.every((row) => qrMatchesTable({ ...row, slug: "phase4e-public-qr-a" }, "qr_url")),
    JSON.stringify(regenerated.rows.map((row) => ({ table_number: row.table_number, qr_token: row.qr_token })).slice(0, 5))
  ));

  results.push(await expectReject(
    "Wrong restaurant slug plus valid token is rejected",
    () => asRole(
      client,
      "anon",
      null,
      "select public.create_public_qr_order($1, '1', $2, 'Cross Tenant', 'Cash', $3::jsonb)",
      ["phase4e-public-qr-b", originalTableOne.qr_token, JSON.stringify([{ menu_item_id: ids.tenantItem, quantity: 1 }])]
    ),
    /Invalid or expired table QR code/i
  ));

  results.push(await expectReject(
    "Owner cannot manage another tenant's table QR codes",
    () => asRole(
      client,
      "authenticated",
      ids.ownerB,
      "select public.regenerate_all_restaurant_table_qr($1)",
      [ids.restaurantA]
    ),
    /Only restaurant owners may manage table QR codes|permission/i
  ));

  results.push(await expectReject(
    "Anon cannot mutate restaurant tables",
    () => asRole(
      client,
      "anon",
      null,
      "update public.restaurant_tables set active = false where restaurant_id = $1 and table_number = 1",
      [ids.restaurantA]
    ),
    /permission denied|violates row-level security|cannot update/i
  ));
}

async function main() {
  const ids = {
    ownerA: uuid("owner-a"),
    ownerB: uuid("owner-b"),
    cashierA: uuid("cashier-a"),
    staffOwnerA: uuid("staff-owner-a"),
    staffOwnerB: uuid("staff-owner-b"),
    staffCashierA: uuid("staff-cashier-a"),
    restaurantA: uuid("restaurant-a"),
    restaurantB: uuid("restaurant-b"),
    stationA: uuid("station-a"),
    stationB: uuid("station-b"),
    categoryA: uuid("category-a"),
    categoryB: uuid("category-b"),
    burger: uuid("burger"),
    coke: uuid("coke"),
    dessert: uuid("dessert"),
    tenantItem: uuid("tenant-item"),
  };

  const results = [];
  const client = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });

  console.log("Starting Phase 4E public QR production hardening audit...");
  await client.connect();
  try {
    console.log("Running source audit...");
    await auditSource(results);
    console.log("Running live table audit...");
    await auditLiveTables(client, results);
    console.log("Running synthetic 20-table lifecycle audit...");
    await auditSyntheticLifecycle(client, ids, results);

    console.log("Running build...");
    try {
      execSync("npm run build", { cwd: sourceRoot, stdio: "pipe" });
      results.push(result("Build passes", true));
    } catch (error) {
      results.push(result("Build passes", false, error.stdout?.toString() || error.message));
    }
  } finally {
    await cleanup(client, ids);
    await client.end();
  }

  const failed = results.filter((entry) => !entry.ok);
  for (const entry of results) {
    console.log(`${entry.ok ? "PASS" : "FAIL"} ${entry.label}: ${entry.detail}`);
  }
  console.log(`Passed: ${results.length - failed.length}`);
  console.log(`Failed: ${failed.length}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
