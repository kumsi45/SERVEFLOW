const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");
const root = path.join(__dirname, "..", "..");
const sql = fs.readFileSync(path.join(root, "supabase", "migrations", "086_phase_p78_authoritative_invoice_creator.sql"), "utf8");
const owner = fs.readFileSync(path.join(root, "src", "modules", "owner", "pages", "OwnerDashboardPage.tsx"), "utf8");
const env = Object.fromEntries(fs.readFileSync(path.join(root, "supabase", "connection.env"), "utf8").split(/\r?\n/).filter((x) => x.includes("=")).map((x) => { const i = x.indexOf("="); return [x.slice(0, i).trim(), x.slice(i + 1).trim().replace(/^['"]|['"]$/g, "")]; }));
const results = [];
const check = (label, ok, detail = "") => results.push({ label, ok: Boolean(ok), detail });
const id = () => crypto.randomUUID();

async function rejected(db, statement, params) {
  await db.query("savepoint expected_rejection");
  try { await db.query(statement, params); await db.query("rollback to savepoint expected_rejection"); return false; }
  catch { await db.query("rollback to savepoint expected_rejection"); return true; }
}

async function main() {
  check("Creator identity constraint uses staff UUID", /foreign key \(restaurant_id, created_by_staff_id\)/.test(sql));
  check("Display snapshot is absent from analytics grouping", /group by invoices\.created_by_staff_id/.test(sql) && !/group by[^;]*created_by_display_name/.test(sql));
  check("Owner client report reads created_by_staff_id", /created_by_staff_id/.test(owner));
  check("Future invoice sources do not require a schema redesign", /\^\[a-z\]\[a-z0-9_\]/.test(sql));

  const db = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const people = await db.query(`select c.restaurant_id,c.id cashier_id,c.user_id cashier_user,w.id waiter_id
      from restaurant_staff c join restaurant_staff w on w.restaurant_id=c.restaurant_id
      where c.role='cashier' and c.active and c.user_id is not null and w.role='waiter' and w.active limit 1`);
    if (!people.rowCount) throw new Error("Audit requires an active cashier and waiter in one restaurant.");
    const p = people.rows[0];
    await db.query("begin");
    const makeOrder = async (source) => {
      const orderId = id();
      await db.query("insert into orders(id,restaurant_id,status,total_price,customer_name,table_number,payment_method,order_source) values($1,$2,'pending_payment',10,'Creator Audit','1','Cash',$3)", [orderId, p.restaurant_id, source]);
      return orderId;
    };
    const qrOrder = await makeOrder("public_qr"), waiterOrder = await makeOrder("waiter"), cashierOrder = await makeOrder("cashier");
    const qrInvoice = id(), waiterInvoice = id(), cashierInvoice = id();
    await db.query("insert into order_invoices(id,restaurant_id,order_id,invoice_number,status,total_price,payment_method,invoice_source,created_by_staff_id,created_by_display_name) values($1,$2,$3,1,'pending',10,'Cash','public_qr',null,'Customer QR')", [qrInvoice, p.restaurant_id, qrOrder]);
    await db.query("insert into order_invoices(id,restaurant_id,order_id,invoice_number,status,total_price,payment_method,invoice_source,created_by_staff_id,created_by_display_name) values($1,$2,$3,1,'pending',10,'Cash','waiter',$4,'Historical Waiter')", [waiterInvoice, p.restaurant_id, waiterOrder, p.waiter_id]);
    await db.query("insert into order_invoices(id,restaurant_id,order_id,invoice_number,status,total_price,payment_method,invoice_source,created_by_staff_id,created_by_display_name) values($1,$2,$3,1,'pending',10,'Cash','cashier',$4,'Historical Cashier')", [cashierInvoice, p.restaurant_id, cashierOrder, p.cashier_id]);
    const rows = await db.query("select id,invoice_source,created_by_staff_id from order_invoices where id=any($1)", [[qrInvoice, waiterInvoice, cashierInvoice]]);
    const bySource = new Map(rows.rows.map((r) => [r.invoice_source, r.created_by_staff_id]));
    check("Customer QR invoices have NULL staff ID", bySource.get("public_qr") === null);
    check("Waiter invoices retain the exact waiter ID", bySource.get("waiter") === p.waiter_id);
    check("Cashier invoices retain the exact cashier ID", bySource.get("cashier") === p.cashier_id);
    check("QR cannot be assigned a staff creator", await rejected(db, "update order_invoices set created_by_staff_id=$1 where id=$2", [p.waiter_id, qrInvoice]));
    check("Waiter invoice cannot lose its staff creator", await rejected(db, "update order_invoices set created_by_staff_id=null where id=$1", [waiterInvoice]));
    check("Cashier invoice cannot use a waiter identity", await rejected(db, "update order_invoices set created_by_staff_id=$1 where id=$2", [p.waiter_id, cashierInvoice]));
    check("Referenced staff cannot be deleted and corrupt ownership", await rejected(db, "delete from restaurant_staff where restaurant_id=$1 and id=$2", [p.restaurant_id, p.waiter_id]));
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [p.cashier_user]);
    const queue = await db.query("select invoice_creator_name from get_cashier_invoice_queue($1) where invoice_id=$2", [p.restaurant_id, cashierInvoice]);
    check("Cashier queue preserves a readable creator", Boolean(queue.rows[0]?.invoice_creator_name), queue.rows[0]?.invoice_creator_name ?? "missing");
    await db.query("reset role");
    await db.query("rollback");
  } catch (error) { await db.query("reset role").catch(() => {}); await db.query("rollback").catch(() => {}); throw error; }
  finally { await db.end(); }
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.label}${r.detail ? ` — ${r.detail}` : ""}`);
  if (results.some((r) => !r.ok)) process.exit(1);
  console.log("\nPASS");
}
main().catch((error) => { console.error(`FAIL audit crashed — ${error.message}`); process.exit(1); });
