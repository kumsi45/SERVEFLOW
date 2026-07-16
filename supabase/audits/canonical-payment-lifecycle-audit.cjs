const fs = require("fs"),
  path = require("path"),
  crypto = require("crypto"),
  { Client } = require("pg");
const env = (file) =>
  Object.fromEntries(
    fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter((x) => x && !x.startsWith("#") && x.includes("="))
      .map((x) => {
        const i = x.indexOf("=");
        return [x.slice(0, i), x.slice(i + 1).replace(/^['"]|['"]$/g, "")];
      }),
  );
async function main() {
  let stage = "connecting";
  const root = path.resolve(__dirname, "../.."),
    db = new Client({
      connectionString: env(path.join(root, "supabase/connection.env"))
        .SUPABASE_DB_URL,
      ssl: { rejectUnauthorized: false },
    }),
    results = [];
  const check = (label, ok, detail = "") =>
    results.push({ label, ok: Boolean(ok), detail });
  await db.connect();
  try {
    const setup = await db.query(
      `select r.id restaurant_id,r.slug,t.id table_id,t.table_number,t.qr_token,w.user_id waiter_user_id,c.user_id cashier_user_id,o.user_id owner_user_id from restaurants r join restaurant_tables t on t.restaurant_id=r.id and t.active join restaurant_staff w on w.restaurant_id=r.id and w.role='waiter' and w.active and w.user_id is not null join restaurant_staff c on c.restaurant_id=r.id and c.role='cashier' and c.active and c.user_id is not null join restaurant_staff o on o.restaurant_id=r.id and o.role='owner' and o.active and o.user_id is not null where r.active and t.qr_token is not null and exists(select 1 from menu_items m where m.restaurant_id=r.id and m.available) and not exists(select 1 from orders x where x.restaurant_id=r.id and x.table_id=t.id and x.dining_session_status='open') limit 1`,
    );
    if (!setup.rowCount)
      throw Error("No restaurant with free QR table and required staff.");
    const a = setup.rows[0],
      item = (
        await db.query(
          "select id from menu_items where restaurant_id=$1 and available limit 1",
          [a.restaurant_id],
        )
      ).rows[0],
      payload = JSON.stringify([
        { menu_item_id: item.id, quantity: 1, notes: null },
      ]),
      original = (
        await db.query("select payment_policy from restaurants where id=$1", [
          a.restaurant_id,
        ])
      ).rows[0].payment_policy;
    const auth = async (role, user) => {
      await db.query("reset role");
      await db.query(`set local role ${role}`);
      await db.query("select set_config('request.jwt.claim.role',$1,true)", [
        role,
      ]);
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
        user ?? "",
      ]);
    };
    const clear = async (id) => {
      await db.query("reset role");
      if (id) {
        await db.query("delete from order_items where order_id=$1", [id]);
        await db.query("delete from order_invoices where order_id=$1", [id]);
        await db.query("delete from orders where id=$1", [id]);
      }
    };
    await db.query("begin");
    for (const mode of ["pay_before_kitchen", "hold_payment", "mixed"]) {
      stage = `${mode}: create waiter order`;
      await auth("authenticated", a.owner_user_id);
      const selectedPolicy = (
        await db.query(
          "select set_restaurant_payment_policy($1,$2) payment_policy",
          [a.restaurant_id, mode],
        )
      ).rows[0].payment_policy;
      check(
        `${mode}: owner policy RPC`,
        selectedPolicy === mode,
        selectedPolicy,
      );
      await auth("authenticated", a.waiter_user_id);
      const created = (
        await db.query(
          "select submit_waiter_order_batch($1,$2,'Lifecycle Audit','','',$3::jsonb,$4) result",
          [a.slug, a.table_number, payload, crypto.randomUUID()],
        )
      ).rows[0].result;
      await db.query("reset role");
      const state = (
          await db.query(
            "select o.operational_status,o.payment_timing,i.payment_status,x.kitchen_status,x.kitchen_station_id from orders o join order_invoices i on i.order_id=o.id join order_items x on x.invoice_id=i.id where i.id=$1",
            [created.invoice_id],
          )
        ).rows[0],
        after = mode === "pay_before_kitchen";
      check(
        `${mode}: canonical initial state`,
        state.payment_timing === (after ? "before_kitchen" : "after_meal") &&
          state.payment_status === (after ? "pending" : "held") &&
          state.kitchen_status === (after ? "held" : "paid"),
        JSON.stringify(state),
      );
      await auth("authenticated", a.owner_user_id);
      stage = `${mode}: query kitchen queue`;
      const visible = await db.query(
        "select id from get_station_kitchen_orders($1,null,true,false) where id=$2",
        [a.restaurant_id, created.order_id],
      );
      check(
        `${mode}: kitchen policy gate`,
        after ? visible.rowCount === 0 : visible.rowCount > 0,
      );
      const canonicalQueue = await db.query(
        "select document from get_canonical_station_kitchen_orders($1,null,true,false) as queue(document) where document->>'id'=$2",
        [a.restaurant_id, created.order_id],
      );
      check(
        `${mode}: kitchen UI keeps station status independent`,
        after
          ? canonicalQueue.rowCount === 0
          : canonicalQueue.rows.every(
              ({ document }) =>
                ["accepted", "preparing", "ready"].includes(document.status) &&
                document.operational_status === state.operational_status &&
                !Object.hasOwn(document, "payment_method") &&
                !Object.hasOwn(document, "payment_verified_at"),
            ),
      );
      if (!after) {
        stage = `${mode}: start kitchen preparation before collection`;
        const started = (
          await db.query(
            "select operational_status from start_order_preparation($1,$2,null)",
            [created.order_id, state.kitchen_station_id],
          )
        ).rows[0];
        check(
          `${mode}: kitchen starts before payment collection`,
          started.operational_status === "preparing",
          JSON.stringify(started),
        );
        stage = `${mode}: mark kitchen order ready`;
        const ready = (
          await db.query(
            "select operational_status from mark_order_ready($1,$2,null)",
            [created.order_id, state.kitchen_station_id],
          )
        ).rows[0];
        check(
          `${mode}: kitchen marks order ready`,
          ready.operational_status === "ready",
          JSON.stringify(ready),
        );
        stage = `${mode}: complete kitchen order`;
        const completed = (
          await db.query(
            "select operational_status from mark_order_completed($1,$2,null)",
            [created.order_id, state.kitchen_station_id],
          )
        ).rows[0];
        check(
          `${mode}: kitchen completes order before collection`,
          completed.operational_status === "served",
          JSON.stringify(completed),
        );
      }
      await auth("authenticated", a.cashier_user_id);
      stage = `${mode}: collect payment`;
      await db.query("select verify_order_payment($1,null,null,null,false)", [
        created.invoice_id,
      ]);
      await db.query("reset role");
      const paid = (
        await db.query(
          "select i.payment_status,o.operational_status from order_invoices i join orders o on o.id=i.order_id and o.restaurant_id=i.restaurant_id where i.id=$1",
          [created.invoice_id],
        )
      ).rows[0];
      check(`${mode}: collect payment -> paid`, paid.payment_status === "paid");
      if (!after)
        check(
          `${mode}: collection does not change kitchen lifecycle`,
          paid.operational_status === "served",
          paid.operational_status,
        );
      await clear(created.order_id);
    }
    await auth("authenticated", a.owner_user_id);
    await db.query("select set_restaurant_payment_policy($1,'mixed')", [
      a.restaurant_id,
    ]);
    await auth("anon", null);
    stage = "mixed: create QR order";
    const qr = (
      await db.query(
        "select create_public_qr_order($1,$2,$3,'Lifecycle QR','Cash',$4::jsonb) result",
        [a.slug, String(a.table_number), String(a.qr_token), payload],
      )
    ).rows[0].result;
    await db.query("reset role");
    const qrState = (
      await db.query(
        "select o.payment_timing,i.payment_status,x.kitchen_status from orders o join order_invoices i on i.order_id=o.id join order_items x on x.invoice_id=i.id where i.id=$1",
        [qr.invoice_id],
      )
    ).rows[0];
    check(
      "mixed: QR remains pay-before",
      qrState.payment_timing === "before_kitchen" &&
        qrState.payment_status === "pending" &&
        qrState.kitchen_status === "held",
      JSON.stringify(qrState),
    );
    await clear(qr.order_id);
    await db.query("update restaurants set payment_policy=$1 where id=$2", [
      original,
      a.restaurant_id,
    ]);
    await db.query("rollback");
  } catch (e) {
    await db.query("reset role").catch(() => {});
    await db.query("rollback").catch(() => {});
    throw new Error(`${stage}: ${e.message}${e.where ? ` (${e.where})` : ""}`);
  } finally {
    await db.end();
  }
  for (const r of results)
    console.log(
      `${r.ok ? "PASS" : "FAIL"} ${r.label}${r.detail ? ` - ${r.detail}` : ""}`,
    );
  if (results.some((r) => !r.ok)) process.exitCode = 1;
  else console.log("PASS");
}
main().catch((e) => {
  console.error(`FAIL audit crashed - ${e.message}`);
  process.exit(1);
});
