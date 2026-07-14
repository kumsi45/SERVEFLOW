const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");

function envFile(file) {
  return Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#") && line.includes("=")).map((line) => {
    const split = line.indexOf("=");
    return [line.slice(0, split).trim(), line.slice(split + 1).trim().replace(/^['"]|['"]$/g, "")];
  }));
}

async function main() {
  const root = path.resolve(__dirname, "../..");
  const connection = envFile(path.join(root, "supabase", "connection.env")).SUPABASE_DB_URL;
  const db = new Client({ connectionString: connection, ssl: { rejectUnauthorized: false } });
  const results = [];
  const check = (label, condition, detail = "") => results.push({ label, condition: Boolean(condition), detail });
  const authenticate = async (userId) => {
    await db.query("reset role");
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
  };

  await db.connect();
  try {
    const setup = await db.query(`
      select restaurants.id restaurant_id, restaurants.slug, tables.table_number,
        waiter.user_id waiter_user_id, cashier.user_id cashier_user_id, owner.user_id owner_user_id
      from public.restaurants restaurants
      join public.restaurant_tables tables on tables.restaurant_id=restaurants.id and tables.active
      join public.restaurant_staff waiter on waiter.restaurant_id=restaurants.id and waiter.role='waiter' and waiter.active and waiter.user_id is not null
      join public.restaurant_staff cashier on cashier.restaurant_id=restaurants.id and cashier.role='cashier' and cashier.active and cashier.user_id is not null
      join public.restaurant_staff owner on owner.restaurant_id=restaurants.id and owner.role='owner' and owner.active and owner.user_id is not null
      where restaurants.active
        and (select count(*) from public.menu_items menu where menu.restaurant_id=restaurants.id and menu.available)>=2
        and not exists (select 1 from public.orders orders where orders.restaurant_id=restaurants.id and orders.table_number=tables.table_number::text and orders.dining_session_status='open' and orders.table_released_at is null)
      order by restaurants.created_at, tables.table_number
      limit 1`);
    if (!setup.rowCount) throw new Error("Audit needs a restaurant with waiter, cashier, owner, two menu items, and one free table.");
    const actor = setup.rows[0];
    const menu = (await db.query("select id,name,price from public.menu_items where restaurant_id=$1 and available order by created_at limit 2", [actor.restaurant_id])).rows;
    const payload = (item) => JSON.stringify([{ menu_item_id: item.id, quantity: 1, notes: null }]);

    await db.query("begin");
    const waiterReleasePrivilege = (await db.query("select has_function_privilege('authenticated','public.close_waiter_table(uuid)','execute') allowed")).rows[0].allowed;
    check("Waiters cannot release dining sessions", waiterReleasePrivilege === false);
    await authenticate(actor.waiter_user_id);
    const first = (await db.query("select public.submit_waiter_order_batch($1,$2,$3,$4,$5,$6::jsonb,$7) result", [actor.slug, actor.table_number, "W10.9 Audit", "", "Batch 1", payload(menu[0]), crypto.randomUUID()])).rows[0].result;
    await db.query("reset role");
    const firstState = (await db.query("select status,total_price from public.order_invoices where id=$1", [first.invoice_id])).rows[0];
    const firstItem = (await db.query("select kitchen_status from public.order_items where invoice_id=$1", [first.invoice_id])).rows[0];
    if (!firstState || !firstItem) throw new Error(`First submission did not return its invoice data: ${JSON.stringify(first)}`);
    check("Batch 1 waits for cashier", firstState.status === "pending" && firstItem.kitchen_status === "held", JSON.stringify({ firstState, firstItem }));

    await authenticate(actor.owner_user_id);
    const kitchenBefore = await db.query("select id from public.get_station_kitchen_orders($1,null,true,false) where id=$2", [actor.restaurant_id, first.order_id]);
    check("Unpaid Batch 1 is invisible to Kitchen", kitchenBefore.rowCount === 0);

    await authenticate(actor.cashier_user_id);
    await db.query("select public.verify_order_payment($1,null,null,null,false)", [first.invoice_id]);
    await authenticate(actor.waiter_user_id);
    const policyAfterPayment = (await db.query("select public.get_waiter_ordering_policy($1) policy", [first.order_id])).rows[0].policy;
    check("Paid batch does not lock the open dining session", policyAfterPayment.allowed === true, JSON.stringify(policyAfterPayment));

    const second = (await db.query("select public.submit_waiter_order_batch($1,$2,$3,$4,$5,$6::jsonb,$7) result", [actor.slug, actor.table_number, "W10.9 Audit", "", "Batch 2", payload(menu[1]), crypto.randomUUID()])).rows[0].result;
    check("Batch 2 reuses the same dining session", second.order_id === first.order_id);
    check("Batch 2 owns a new invoice", second.invoice_id !== first.invoice_id && Number(second.invoice_number) === Number(first.invoice_number) + 1, JSON.stringify({ first, second }));
    await db.query("reset role");
    const openSessions = await db.query("select id from public.orders where restaurant_id=$1 and table_number=$2 and dining_session_status='open' and table_released_at is null", [actor.restaurant_id, actor.table_number]);
    check("Exactly one open dining session exists", openSessions.rowCount === 1);
    const mixed = await db.query(`select invoices.id,invoices.status,items.kitchen_status from public.order_invoices invoices join public.order_items items on items.invoice_id=invoices.id where invoices.id=any($1::uuid[]) order by invoices.invoice_number`, [[first.invoice_id, second.invoice_id]]);
    check("Batch 1 remains paid while Batch 2 independently waits", mixed.rows[0].status === "verified" && mixed.rows[0].kitchen_status === "paid" && mixed.rows[1].status === "pending" && mixed.rows[1].kitchen_status === "held", JSON.stringify(mixed.rows));

    await authenticate(actor.owner_user_id);
    const kitchenMixed = (await db.query("select items from public.get_station_kitchen_orders($1,null,true,false) where id=$2", [actor.restaurant_id, first.order_id])).rows;
    const visibleItemIds = new Set(kitchenMixed.flatMap((row) => row.items ?? []).map((item) => item.id));
    await db.query("reset role");
    const itemIds = (await db.query("select id,invoice_id from public.order_items where invoice_id=any($1::uuid[])", [[first.invoice_id, second.invoice_id]])).rows;
    check("Kitchen sees paid Batch 1 but not pending Batch 2", visibleItemIds.has(itemIds.find((item) => item.invoice_id === first.invoice_id).id) && !visibleItemIds.has(itemIds.find((item) => item.invoice_id === second.invoice_id).id));

    await authenticate(actor.cashier_user_id);
    await db.query("select public.verify_order_payment($1,null,null,null,false)", [second.invoice_id]);
    await authenticate(actor.owner_user_id);
    const kitchenPaid = (await db.query("select items from public.get_station_kitchen_orders($1,null,true,false) where id=$2", [actor.restaurant_id, first.order_id])).rows;
    const paidIds = new Set(kitchenPaid.flatMap((row) => row.items ?? []).map((item) => item.id));
    check("Kitchen receives Batch 2 only after its cashier verification", itemIds.every((item) => paidIds.has(item.id)));
    await db.query("reset role");
    const final = (await db.query("select dining_session_status,table_released_at,total_price from public.orders where id=$1", [first.order_id])).rows[0];
    check("Dining session remains open after all batch payments", final.dining_session_status === "open" && final.table_released_at === null, JSON.stringify(final));

    await db.query("reset role");
    await db.query("rollback");
  } catch (error) {
    await db.query("reset role").catch(() => {});
    await db.query("rollback").catch(() => {});
    throw error;
  } finally {
    await db.end();
  }

  for (const result of results) console.log(`${result.condition ? "PASS" : "FAIL"} ${result.label}${result.detail ? ` - ${result.detail}` : ""}`);
  if (results.some((result) => !result.condition)) process.exitCode = 1;
  else console.log("\nPASS");
}

main().catch((error) => { console.error(`FAIL audit crashed - ${error.message}`); process.exit(1); });
