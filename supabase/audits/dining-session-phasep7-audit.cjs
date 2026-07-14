const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");

const root = path.join(__dirname, "..", "..");
const migrationPath = path.join(root, "supabase", "migrations", "078_phase_p7_dining_session_finalization.sql");
const migration = fs.readFileSync(migrationPath, "utf8");

function readKeyValueFile(filePath) {
  return Object.fromEntries(
    fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")];
      })
  );
}

function uuid(label) {
  const chars = crypto.createHash("sha256").update(`serveflow-p7-dining-session-${label}`).digest("hex").slice(0, 32).split("");
  chars[12] = "4";
  chars[16] = ((parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const hex = chars.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function idsFor(label) {
  return {
    restaurant: uuid(`${label}-restaurant`),
    table: uuid(`${label}-table`),
    qrToken: uuid(`${label}-qr-token`),
    ownerUser: uuid(`${label}-owner-user`),
    cashierUser: uuid(`${label}-cashier-user`),
    kitchenUser: uuid(`${label}-kitchen-user`),
    waiterUser: uuid(`${label}-waiter-user`),
    ownerStaff: uuid(`${label}-owner-staff`),
    cashierStaff: uuid(`${label}-cashier-staff`),
    kitchenStaff: uuid(`${label}-kitchen-staff`),
    waiterStaff: uuid(`${label}-waiter-staff`),
    category: uuid(`${label}-category`),
    menuItem: uuid(`${label}-menu-item`),
    slug: `p7-dining-session-audit-${label}`,
  };
}

function result(label, ok, detail = "") {
  return { label, ok, detail };
}

async function asRole(client, role, userId, sql, params = []) {
  await client.query(`set local role ${role}`);
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId || ""]);
  const output = await client.query(sql, params);
  await client.query("reset role");
  await client.query("select set_config('request.jwt.claim.sub', '', true)");
  return output;
}

async function cleanup(client, ids) {
  for (const table of [
    "receipt_generation_events",
    "shift_activity_logs",
    "cashier_shifts",
    "order_items",
    "order_invoices",
    "orders",
    "menu_items",
    "categories",
    "restaurant_tables",
    "restaurant_staff",
  ]) {
    await client.query(`delete from public.${table} where restaurant_id = $1`, [ids.restaurant]).catch(() => {});
  }
  await client.query("delete from public.restaurants where id = $1 or slug = $2", [ids.restaurant, ids.slug]).catch(() => {});
  await client.query("delete from auth.users where id = any($1::uuid[])", [[ids.ownerUser, ids.cashierUser, ids.kitchenUser, ids.waiterUser]]).catch(() => {});
}

async function seed(client, ids) {
  await client.query(
    `
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values
      ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $5, '', now(), now(), now()),
      ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $6, '', now(), now(), now()),
      ($3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $7, '', now(), now(), now()),
      ($4, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $8, '', now(), now(), now())
  `,
    [
      ids.ownerUser,
      ids.cashierUser,
      ids.kitchenUser,
      ids.waiterUser,
      `${ids.slug}-owner@example.test`,
      `${ids.slug}-cashier@example.test`,
      `${ids.slug}-kitchen@example.test`,
      `${ids.slug}-waiter@example.test`,
    ]
  );

  await client.query(
    `
    insert into public.restaurants (id, name, slug, total_tables, security_settings)
    values ($1, 'P7 Dining Session Audit', $2, 1, '{"dining_session_timeout_minutes": 15}'::jsonb)
  `,
    [ids.restaurant, ids.slug]
  );

  await client.query(
    `
    insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, active)
    values
      ($1, $2, $3, 'owner', 'P7 Owner', true),
      ($4, $2, $5, 'cashier', 'P7 Cashier', true),
      ($6, $2, $7, 'kitchen', 'P7 Kitchen', true),
      ($8, $2, $9, 'waiter', 'P7 Waiter', true)
  `,
    [ids.ownerStaff, ids.restaurant, ids.ownerUser, ids.cashierStaff, ids.cashierUser, ids.kitchenStaff, ids.kitchenUser, ids.waiterStaff, ids.waiterUser]
  );

  await client.query(
    `
    insert into public.restaurant_tables (id, restaurant_id, table_number, label, qr_path, qr_url, qr_token, active)
    values ($1, $2, 1, 'Table 1', '/r/' || $3 || '/order?t=1&qr=' || $4::text, 'https://example.test/r/' || $3 || '/order?t=1&qr=' || $4::text, $4::uuid, true)
    on conflict (restaurant_id, table_number) do update set
      id = excluded.id,
      label = excluded.label,
      qr_path = excluded.qr_path,
      qr_url = excluded.qr_url,
      qr_token = excluded.qr_token,
      active = true,
      updated_at = now()
  `,
    [ids.table, ids.restaurant, ids.slug, ids.qrToken]
  );

  await client.query("insert into public.categories (id, restaurant_id, name) values ($1, $2, 'Audit')", [ids.category, ids.restaurant]);
  await client.query("select set_config('request.jwt.claim.sub', $1, false)", [ids.ownerUser]);
  await client.query("insert into public.menu_items (id, restaurant_id, category_id, name, price, available) values ($1, $2, $3, 'Audit Item', 10, true)", [ids.menuItem, ids.restaurant, ids.category]);
  await client.query("insert into public.cashier_shifts (restaurant_id, opened_by, opening_cash, notes) values ($1, $2, 0, 'P7 audit')", [ids.restaurant, ids.cashierStaff]);
}

async function runScenario(client, label, fn) {
  const ids = idsFor(label.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  await cleanup(client, ids);
  await client.query("begin");
  try {
    await seed(client, ids);
    const scenarioResult = await fn(ids);
    await client.query("rollback");
    await cleanup(client, ids);
    return scenarioResult;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    await cleanup(client, ids);
    return result(label, false, error instanceof Error ? error.stack || error.message : String(error));
  }
}

async function verifyInvoice(client, ids, invoiceId, reference = null) {
  return asRole(client, "authenticated", ids.cashierUser, "select public.verify_order_payment($1, $2, null, null, false)", [invoiceId, reference]);
}

async function completeInvoiceInKitchen(client, ids, orderId, invoiceId) {
  const batch = await client.query(
    `
      select
        case
          when min(appended_at) is null then null
          else ((extract(epoch from min(appended_at)) * 1000000)::bigint)::text
        end as batch_key
      from public.order_items
      where order_id = $1
        and invoice_id = $2
    `,
    [orderId, invoiceId]
  );
  const batchKey = batch.rows[0].batch_key;
  await asRole(client, "authenticated", ids.kitchenUser, "select public.start_order_preparation($1, null::uuid, $2::text)", [orderId, batchKey]);
  await asRole(client, "authenticated", ids.kitchenUser, "select public.mark_order_ready($1, null::uuid, $2::text)", [orderId, batchKey]);
  await asRole(client, "authenticated", ids.kitchenUser, "select public.mark_order_completed($1, null::uuid, $2::text)", [orderId, batchKey]);
}

async function queueRows(client, ids, orderId) {
  return asRole(
    client,
    "authenticated",
    ids.cashierUser,
    "select invoice_id, invoice_number, invoice_status, payment_method, total_price from public.get_cashier_invoice_queue($1) where id = $2 order by invoice_number",
    [ids.restaurant, orderId]
  );
}

async function verifiedRevenue(client, ids) {
  const rows = await client.query(
    "select coalesce(sum(total_price), 0)::numeric as total from public.order_invoices where restaurant_id = $1 and status = 'verified'",
    [ids.restaurant]
  );
  return Number(rows.rows[0].total);
}

async function kitchenReleasedCount(client, orderId, invoiceId) {
  const rows = await client.query(
    "select count(*)::int as count from public.order_items where order_id = $1 and invoice_id = $2 and kitchen_status <> 'held'",
    [orderId, invoiceId]
  );
  return rows.rows[0].count;
}

async function activeOpenSessionCount(client, ids) {
  const rows = await client.query(
    `
      select count(*)::int as count
      from public.orders
      where restaurant_id = $1
        and table_number = '1'
        and public.is_public_qr_dining_session_open(id)
    `,
    [ids.restaurant]
  );
  return rows.rows[0].count;
}

async function main() {
  const results = [
    result("Static lifecycle columns exist", /dining_session_status/.test(migration) && /table_released_at/.test(migration)),
    result("Static QR additional orders always create new payment batch", /select coalesce\(max\(invoice_number\), 0\) \+ 1[\s\S]*insert into public\.order_invoices/.test(migration)),
    result("Static stale session lookup uses open lifecycle function", /public\.is_public_qr_dining_session_open\(orders\.id\)/.test(migration)),
  ];

  const env = readKeyValueFile(path.join(root, "supabase", "connection.env"));
  const client = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const migrationCheck = await client.query(`
      select
        exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'dining_session_status') as has_status,
        exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'table_released_at') as has_released_at,
        to_regprocedure('public.close_dining_session(uuid,text)') is not null as has_close,
        to_regprocedure('public.close_public_qr_dining_session(text,text,text,uuid)') is not null as has_public_close,
        to_regprocedure('public.expire_stale_dining_sessions(uuid)') is not null as has_expire
    `);
    const migrationReady = Object.values(migrationCheck.rows[0]).every(Boolean);
    results.push(result("P7 migration is present in configured development database", migrationReady, JSON.stringify(migrationCheck.rows[0])));

    results.push(await runScenario(client, "Scenario A: next customer receives a clean dining session", async (ids) => {
      const scanA = await asRole(client, "anon", null, "select public.get_public_qr_order_session($1, '1', $2) as session", [ids.slug, ids.qrToken]);
      const sessionA = scanA.rows[0].session;
      const batch1 = await asRole(client, "anon", null, "select public.create_public_qr_order($1, '1', $2, 'Guest A', 'Cash', $3::jsonb) as payload", [
        ids.slug,
        ids.qrToken,
        JSON.stringify([{ menu_item_id: ids.menuItem, quantity: 1 }]),
      ]);
      const orderA = batch1.rows[0].payload.order_id;
      const invoiceA1 = batch1.rows[0].payload.invoice_id;
      await verifyInvoice(client, ids, invoiceA1);
      await completeInvoiceInKitchen(client, ids, orderA, invoiceA1);
      await asRole(client, "anon", null, "select public.close_public_qr_dining_session($1, '1', $2, $3)", [ids.slug, ids.qrToken, orderA]);
      const scanB = await asRole(client, "anon", null, "select public.get_public_qr_order_session($1, '1', $2) as session", [ids.slug, ids.qrToken]);
      const sessionB = scanB.rows[0].session;
      const closedOrder = await client.query("select dining_session_status, table_released_at from public.orders where id = $1", [orderA]);
      return result(
        "Scenario A: next customer receives a clean dining session",
        sessionA.order_id === orderA &&
          sessionB.order_id !== orderA &&
          sessionB.items.length === 0 &&
          sessionB.invoices.length === 0 &&
          closedOrder.rows[0].dining_session_status === "closed" &&
          Boolean(closedOrder.rows[0].table_released_at),
        JSON.stringify({ first: orderA, next: sessionB.order_id, closed: closedOrder.rows[0] })
      );
    }));

    results.push(await runScenario(client, "Scenario B: QR Batch 2 is independent and revenue gates on verification", async (ids) => {
      const batch1 = await asRole(client, "anon", null, "select public.create_public_qr_order($1, '1', $2, 'Guest B', 'Cash', $3::jsonb) as payload", [
        ids.slug,
        ids.qrToken,
        JSON.stringify([{ menu_item_id: ids.menuItem, quantity: 1 }]),
      ]);
      const orderId = batch1.rows[0].payload.order_id;
      const invoice1 = batch1.rows[0].payload.invoice_id;
      await verifyInvoice(client, ids, invoice1, "P7-B1");
      const revenueAfterBatch1 = await verifiedRevenue(client, ids);
      await client.query("update public.orders set updated_at = now() - interval '20 minutes' where id = $1", [orderId]);
      const batch2 = await asRole(client, "anon", null, "select public.create_public_qr_order($1, '1', $2, 'Guest B', 'Telebirr', $3::jsonb) as payload", [
        ids.slug,
        ids.qrToken,
        JSON.stringify([{ menu_item_id: ids.menuItem, quantity: 2 }]),
      ]);
      const invoice2 = batch2.rows[0].payload.invoice_id;
      const revenueWhilePending = await verifiedRevenue(client, ids);
      const queueBeforeVerify = await queueRows(client, ids, orderId);
      const releasedBeforeVerify = await kitchenReleasedCount(client, orderId, invoice2);
      await verifyInvoice(client, ids, invoice2, "P7-B2");
      const revenueAfterBatch2 = await verifiedRevenue(client, ids);
      const releasedAfterVerify = await kitchenReleasedCount(client, orderId, invoice2);
      return result(
        "Scenario B: QR Batch 2 is independent and revenue gates on verification",
        batch2.rows[0].payload.order_id === orderId &&
          batch2.rows[0].payload.invoice_number === 2 &&
          revenueAfterBatch1 === 10 &&
          revenueWhilePending === 10 &&
          revenueAfterBatch2 === 30 &&
          queueBeforeVerify.rows.some((row) => row.invoice_id === invoice2 && row.invoice_status === "pending" && Number(row.total_price) === 20) &&
          releasedBeforeVerify === 0 &&
          releasedAfterVerify > 0,
        JSON.stringify({ revenueAfterBatch1, revenueWhilePending, revenueAfterBatch2, queue: queueBeforeVerify.rows })
      );
    }));

    results.push(await runScenario(client, "Scenario C: waiter batches stay separate and release separately", async (ids) => {
      const waiter1 = await asRole(client, "authenticated", ids.waiterUser, "select public.create_waiter_order($1, '1', 'Waiter Guest', null, null, $2::jsonb) as payload", [
        ids.slug,
        JSON.stringify([{ menu_item_id: ids.menuItem, quantity: 1 }]),
      ]);
      const orderId = waiter1.rows[0].payload.order_id;
      const invoice1 = waiter1.rows[0].payload.invoice_id;
      await verifyInvoice(client, ids, invoice1, "P7-W1");
      const waiter2 = await asRole(client, "authenticated", ids.waiterUser, "select public.create_waiter_order($1, '1', 'Waiter Guest', null, null, $2::jsonb) as payload", [
        ids.slug,
        JSON.stringify([{ menu_item_id: ids.menuItem, quantity: 2 }]),
      ]);
      const invoice2 = waiter2.rows[0].payload.invoice_id;
      const queueBeforeVerify = await queueRows(client, ids, orderId);
      const releasedBeforeVerify = await kitchenReleasedCount(client, orderId, invoice2);
      await verifyInvoice(client, ids, invoice2, "P7-W2");
      const releasedInvoice1 = await kitchenReleasedCount(client, orderId, invoice1);
      const releasedInvoice2 = await kitchenReleasedCount(client, orderId, invoice2);
      return result(
        "Scenario C: waiter batches stay separate and release separately",
        waiter2.rows[0].payload.order_id === orderId &&
          waiter2.rows[0].payload.invoice_number === 2 &&
          queueBeforeVerify.rows.length === 2 &&
          queueBeforeVerify.rows.some((row) => row.invoice_id === invoice1 && row.invoice_status === "verified") &&
          queueBeforeVerify.rows.some((row) => row.invoice_id === invoice2 && row.invoice_status === "pending") &&
          releasedBeforeVerify === 0 &&
          releasedInvoice1 > 0 &&
          releasedInvoice2 > 0,
        JSON.stringify(queueBeforeVerify.rows)
      );
    }));

    results.push(await runScenario(client, "Scenario D: timeout expires abandoned session and frees the table", async (ids) => {
      const abandoned = await asRole(client, "anon", null, "select public.get_public_qr_order_session($1, '1', $2) as session", [ids.slug, ids.qrToken]);
      const abandonedOrder = abandoned.rows[0].session.order_id;
      await client.query("update public.orders set dining_session_expires_at = now() - interval '1 minute' where id = $1", [abandonedOrder]);
      const expired = await client.query("select public.expire_stale_dining_sessions($1) as expired", [ids.restaurant]);
      const expiredOrder = await client.query("select dining_session_status, status, table_released_at from public.orders where id = $1", [abandonedOrder]);
      const afterExpiry = await asRole(client, "anon", null, "select public.get_public_qr_order_session($1, '1', $2) as session", [ids.slug, ids.qrToken]);
      const openCount = await activeOpenSessionCount(client, ids);
      return result(
        "Scenario D: timeout expires abandoned session and frees the table",
        Number(expired.rows[0].expired) === 1 &&
          expiredOrder.rows[0].dining_session_status === "expired" &&
          Boolean(expiredOrder.rows[0].table_released_at) &&
          afterExpiry.rows[0].session.order_id !== abandonedOrder &&
          openCount === 1,
        JSON.stringify({ abandonedOrder, nextOrder: afterExpiry.rows[0].session.order_id, expired: expired.rows[0].expired, expiredOrder: expiredOrder.rows[0], openCount })
      );
    }));

    results.push(await runScenario(client, "Closed or expired dining sessions are never considered open", async (ids) => {
      const created = await asRole(client, "anon", null, "select public.create_public_qr_order($1, '1', $2, 'Leak Check', 'Cash', $3::jsonb) as payload", [
        ids.slug,
        ids.qrToken,
        JSON.stringify([{ menu_item_id: ids.menuItem, quantity: 1 }]),
      ]);
      const orderId = created.rows[0].payload.order_id;
      const invoiceId = created.rows[0].payload.invoice_id;
      await verifyInvoice(client, ids, invoiceId);
      await completeInvoiceInKitchen(client, ids, orderId, invoiceId);
      await asRole(client, "anon", null, "select public.close_public_qr_dining_session($1, '1', $2, $3)", [ids.slug, ids.qrToken, orderId]);
      const staleLeak = await client.query(
        `
          select count(*)::int as count
          from public.orders
          where restaurant_id = $1
            and dining_session_status in ('closed', 'expired', 'abandoned')
            and public.is_public_qr_dining_session_open(id)
        `,
        [ids.restaurant]
      );
      return result("Closed or expired dining sessions are never considered open", staleLeak.rows[0].count === 0, JSON.stringify(staleLeak.rows[0]));
    }));
  } catch (error) {
    results.push(result("Live P7 audit completed without uncaught error", false, error instanceof Error ? error.stack || error.message : String(error)));
  } finally {
    await client.end();
  }

  const failed = results.filter((entry) => !entry.ok);
  for (const entry of results) {
    console.log(`${entry.ok ? "PASS" : "FAIL"} ${entry.label}${entry.detail ? `: ${entry.detail}` : ""}`);
  }
  console.log(`Passed: ${results.length - failed.length}`);
  console.log(`Failed: ${failed.length}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
