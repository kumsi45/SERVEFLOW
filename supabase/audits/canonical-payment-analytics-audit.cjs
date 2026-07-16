const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");

const env = Object.fromEntries(
  fs
    .readFileSync(path.resolve(__dirname, "../connection.env"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [
        line.slice(0, index),
        line.slice(index + 1).replace(/^['"]|['"]$/g, ""),
      ];
    }),
);

async function main() {
  let currentMethod = "setup";
  const db = new Client({
    connectionString: env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  const checks = [];
  const check = (label, ok, detail = "") =>
    checks.push({ label, ok: Boolean(ok), detail });
  await db.connect();
  try {
    const actor = (
      await db.query(`select r.id restaurant_id,r.slug,t.table_number,w.user_id waiter_user_id,c.user_id cashier_user_id,o.user_id owner_user_id,m.id menu_item_id
      from restaurants r join restaurant_tables t on t.restaurant_id=r.id and t.active
      join restaurant_staff w on w.restaurant_id=r.id and w.role='waiter' and w.active and w.user_id is not null
      join restaurant_staff c on c.restaurant_id=r.id and c.role='cashier' and c.active and c.user_id is not null
      join restaurant_staff o on o.restaurant_id=r.id and o.role='owner' and o.active and o.user_id is not null
      join menu_items m on m.restaurant_id=r.id and m.available and m.price > 0
      where r.active and not exists(select 1 from orders x where x.restaurant_id=r.id and x.table_id=t.id and x.dining_session_status='open') limit 1`)
    ).rows[0];
    if (!actor)
      throw new Error(
        "Audit fixture requires a free table and active waiter/cashier/owner.",
      );
    const auth = async (user) => {
      await db.query("reset role");
      await db.query("set local role authenticated");
      await db.query(
        "select set_config('request.jwt.claim.role','authenticated',true)",
      );
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
        user,
      ]);
    };
    const payload = JSON.stringify([
      { menu_item_id: actor.menu_item_id, quantity: 1, notes: null },
    ]);
    const methods = [
      "Cash",
      "Card",
      "Telebirr",
      "CBE Birr",
      "Chapa",
      "Mobile Banking",
    ];
    await db.query("begin");
    await auth(actor.owner_user_id);
    await db.query("select set_restaurant_payment_policy($1,'hold_payment')", [
      actor.restaurant_id,
    ]);
    for (const method of methods) {
      currentMethod = method;
      await auth(actor.waiter_user_id);
      const created = (
        await db.query(
          "select submit_waiter_order_batch($1,$2,'Analytics Audit','','',$3::jsonb,$4) result",
          [actor.slug, actor.table_number, payload, crypto.randomUUID()],
        )
      ).rows[0].result;
      await db.query("reset role");
      await db.query(
        "update order_invoices set payment_method=$1 where id=$2 and restaurant_id=$3",
        [method, created.invoice_id, actor.restaurant_id],
      );
      await auth(actor.cashier_user_id);
      await db.query("select verify_order_payment($1,null,null,null,false)", [
        created.invoice_id,
      ]);
      await db.query("reset role");
      const paid = (
        await db.query(
          "select payment_status,payment_method,total_price,paid_at from order_invoices where id=$1 and restaurant_id=$2",
          [created.invoice_id, actor.restaurant_id],
        )
      ).rows[0];
      check(
        `${method}: queue collection becomes Paid`,
        paid.payment_status === "paid" &&
          Boolean(paid.paid_at) &&
          Number(paid.total_price) > 0,
        JSON.stringify(paid),
      );
      check(
        `${method}: method retained for analytics`,
        paid.payment_method === method,
        paid.payment_method,
      );
      await db.query("delete from order_items where order_id=$1", [
        created.order_id,
      ]);
      await db.query("delete from order_invoices where order_id=$1", [
        created.order_id,
      ]);
      await db.query("delete from orders where id=$1", [created.order_id]);
    }
    const publication = await db.query(
      "select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='order_invoices'",
    );
    check(
      "Canonical invoices are realtime-published",
      publication.rowCount === 1,
    );
    await db.query("rollback");
  } catch (error) {
    await db.query("reset role").catch(() => {});
    await db.query("rollback").catch(() => {});
    throw new Error(`${currentMethod}: ${error.message}`);
  } finally {
    await db.end();
  }
  for (const item of checks)
    console.log(
      `${item.ok ? "PASS" : "FAIL"} ${item.label}${item.detail ? ` - ${item.detail}` : ""}`,
    );
  if (checks.some((item) => !item.ok)) process.exitCode = 1;
  else console.log("PASS");
}
main().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exit(1);
});
