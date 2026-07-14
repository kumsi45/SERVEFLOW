const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");

const root = path.join(__dirname, "..", "..");
const migration = fs.readFileSync(path.join(root, "supabase", "migrations", "085_phase_p78_payment_to_kitchen_hardening.sql"), "utf8");
const tracker = fs.readFileSync(path.join(root, "src", "modules", "qr-menu", "pages", "QRMenuPage.tsx"), "utf8");
const kitchen = fs.readFileSync(path.join(root, "src", "modules", "kitchen", "pages", "KitchenDashboardPage.tsx"), "utf8");
const cashier = fs.readFileSync(path.join(root, "src", "modules", "cashier", "pages", "CashierDashboardPage.tsx"), "utf8");

function envFile(file) {
  return Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/).map((x) => x.trim()).filter((x) => x && !x.startsWith("#") && x.includes("=")).map((x) => {
    const i = x.indexOf("="); return [x.slice(0, i).trim(), x.slice(i + 1).trim().replace(/^['"]|['"]$/g, "")];
  }));
}
function id() { return crypto.randomUUID(); }
function check(results, label, ok, detail = "") { results.push({ label, ok: Boolean(ok), detail }); }

async function main() {
  const results = [];
  check(results, "Single verification gateway wraps the complete payment transaction", /verify_order_payment_p78_base/.test(migration));
  check(results, "Gateway rejects verified invoices with held items", /held_item_count <> 0/.test(migration));
  check(results, "Gateway exclusively crosses pending payment to paid", /status = 'paid'[\s\S]*status::text = 'pending_payment'/.test(migration));
  check(results, "Gateway derives customer lifecycle before commit", /derive_order_status_from_items/.test(migration));
  check(results, "Customer listens to invoice, item, and order realtime", ["orders", "order_invoices", "order_items"].every((table) => new RegExp(`table: [\\\"']${table}`).test(tracker)));
  check(results, "Kitchen listens to order and item realtime", /table: "orders"/.test(kitchen) && /table: "order_items"/.test(kitchen));
  check(results, "Cashier listens to invoice, item, and order realtime", ["orders", "order_invoices", "order_items"].every((table) => new RegExp(`table: [\\\"']${table}`).test(cashier)));

  const connection = envFile(path.join(root, "supabase", "connection.env")).SUPABASE_DB_URL;
  const db = new Client({ connectionString: connection, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const staff = await db.query(`select rs.restaurant_id, rs.user_id, rs.id staff_id
      from public.restaurant_staff rs where rs.active and rs.user_id is not null and rs.role = 'owner'
      and exists (select 1 from public.menu_items mi where mi.restaurant_id=rs.restaurant_id and mi.available)
      limit 1`);
    if (!staff.rowCount) throw new Error("Audit needs one active owner with an available menu item.");
    const actor = staff.rows[0];
    const menu = (await db.query("select id, price from public.menu_items where restaurant_id=$1 and available limit 1", [actor.restaurant_id])).rows[0];
    const station = (await db.query("select public.ensure_main_kitchen_station_for_restaurant($1) id", [actor.restaurant_id])).rows[0].id;
    const creatorRows = await db.query("select role,id from restaurant_staff where restaurant_id=$1 and active and role in ('waiter','cashier')", [actor.restaurant_id]);
    const creatorByRole = new Map(creatorRows.rows.map((row) => [row.role, row.id]));
    if (!creatorByRole.get("waiter") || !creatorByRole.get("cashier")) throw new Error("Audit requires active waiter and cashier creators.");
    const cases = ["public_qr", "waiter", "cashier"];
    const seeded = [];
    await db.query("begin");
    for (const source of cases) {
      const order = id(), invoice = id(), item = id(); seeded.push({ source, order, invoice, item });
      await db.query(`insert into public.orders(id,restaurant_id,status,total_price,customer_name,table_number,payment_method,order_source)
        values($1,$2,'pending_payment',$3,'P7.8 Audit','1','Cash',$4)`, [order, actor.restaurant_id, menu.price, source]);
      await db.query(`insert into public.order_invoices(id,restaurant_id,order_id,invoice_number,status,total_price,payment_method,invoice_source,created_by_staff_id,created_by_display_name)
        values($1,$2,$3,900,'pending',$4,'Cash',$5,$6,'P7.8 Creator')`, [invoice, actor.restaurant_id, order, menu.price, source, source === "public_qr" ? null : creatorByRole.get(source)]);
      await db.query(`insert into public.order_items(id,restaurant_id,order_id,invoice_id,menu_item_id,quantity,price,kitchen_status,kitchen_station_id)
        values($1,$2,$3,$4,$5,1,$6,'held',$7)`, [item, actor.restaurant_id, order, invoice, menu.id, menu.price, station]);
    }
    const unpaid = { order: id(), invoice: id(), item: id() };
    await db.query("insert into public.orders(id,restaurant_id,status,total_price,customer_name,table_number,payment_method,order_source) values($1,$2,'pending_payment',$3,'Unpaid Audit','1','Cash','public_qr')", [unpaid.order, actor.restaurant_id, menu.price]);
    await db.query("insert into public.order_invoices(id,restaurant_id,order_id,invoice_number,status,total_price,payment_method,invoice_source) values($1,$2,$3,901,'pending',$4,'Cash','public_qr')", [unpaid.invoice, actor.restaurant_id, unpaid.order, menu.price]);
    await db.query("insert into public.order_items(id,restaurant_id,order_id,invoice_id,menu_item_id,quantity,price,kitchen_status,kitchen_station_id) values($1,$2,$3,$4,$5,1,$6,'held',$7)", [unpaid.item, actor.restaurant_id, unpaid.order, unpaid.invoice, menu.id, menu.price, station]);
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor.user_id]);
    for (const row of seeded) {
      await db.query("select public.verify_order_payment($1,null,null,null,false)", [row.invoice]);
      const state = (await db.query(`select i.status invoice_status,o.status order_status,oi.kitchen_status
        from public.order_invoices i join public.orders o on o.id=i.order_id join public.order_items oi on oi.invoice_id=i.id where i.id=$1`, [row.invoice])).rows[0];
      check(results, `${row.source} order verifies and reaches kitchen`, state.invoice_status === "verified" && state.order_status === "paid" && state.kitchen_status === "paid", JSON.stringify(state));
    }
    const queue = await db.query("select id from public.get_station_kitchen_orders($1,$2,false,false)", [actor.restaurant_id, station]);
    const visible = new Set(queue.rows.map((x) => x.id));
    check(results, "All verified source workflows appear in kitchen queue", seeded.every((x) => visible.has(x.order)));
    check(results, "Kitchen never receives unpaid invoices", !visible.has(unpaid.order));
    const unpaidState = (await db.query("select status from public.orders where id=$1", [unpaid.order])).rows[0].status;
    check(results, "Only verified invoice items move into kitchen", unpaidState === "pending_payment");
    await db.query("reset role");
    await db.query("rollback");

    const publication = await db.query("select tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=any($1)", [["orders", "order_items", "order_invoices"]]);
    check(results, "Realtime publishes Customer, Cashier, and Kitchen state tables", publication.rowCount === 3, publication.rows.map((x) => x.tablename).join(", "));
  } catch (error) {
    await db.query("reset role").catch(() => {}); await db.query("rollback").catch(() => {}); throw error;
  } finally { await db.end(); }

  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.label}${r.detail ? ` — ${r.detail}` : ""}`);
  if (results.some((r) => !r.ok)) process.exitCode = 1;
  else console.log("\nPASS");
}
main().catch((e) => { console.error(`FAIL audit crashed — ${e.message}`); process.exit(1); });
