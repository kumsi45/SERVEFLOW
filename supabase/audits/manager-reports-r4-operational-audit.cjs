const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Client } = require("pg");

const root = path.resolve(__dirname, "../..");
const env = Object.fromEntries(fs.readFileSync(path.join(root, "supabase/connection.env"), "utf8")
  .split(/\r?\n/).filter((line) => line.includes("="))
  .map((line) => { const split = line.indexOf("="); return [line.slice(0, split).trim(), line.slice(split + 1).trim().replace(/^["']|["']$/g, "")]; }));
const migration = fs.readFileSync(path.join(root, "supabase/migrations/239_manager_reports_r4_operational_reporting.sql"), "utf8");
const db = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const id = () => crypto.randomUUID();
const results = [];
const check = (letter, label, ok, detail = "") => results.push({ letter, label, ok: Boolean(ok), detail });

async function asActor(userId, functionName, args) {
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
  const response = await db.query(`select public.${functionName}(${args.map((_, index) => `$${index + 1}`).join(",")}) result`, args);
  await db.query("reset role");
  return response.rows[0].result;
}

async function denied(userId, functionName, args) {
  await db.query("savepoint expected_denial");
  try { const result = await asActor(userId, functionName, args); await db.query("rollback to savepoint expected_denial"); return result?.error === "Permission denied."; }
  catch { await db.query("rollback to savepoint expected_denial"); await db.query("reset role"); return true; }
}

async function main() {
  await db.connect(); await db.query("begin");
  try {
    if (process.env.SERVEFLOW_R4_USE_DEPLOYED !== "1") await db.query(migration);
    const users = (await db.query("select id from auth.users order by created_at,id limit 4")).rows.map((row) => row.id);
    if (users.length < 4) throw new Error("R4 audit requires four existing auth users; none are modified.");
    const [managerUser, otherManagerUser, waiterUser, kitchenUser] = users;
    const tenant = id(), otherTenant = id(), suffix = crypto.randomBytes(6).toString("hex");
    await db.query("insert into public.restaurants(id,name,slug) values($1,'R4 Audit',$2),($3,'R4 Other',$4)", [tenant, `r4-${suffix}`, otherTenant, `r4-other-${suffix}`]);
    const staff = (await db.query(`insert into public.restaurant_staff(restaurant_id,user_id,role,display_name,active) values
      ($1,$2,'manager','R4 Manager',true),($3,$4,'manager','Other Manager',true),($1,$5,'waiter','R4 Waiter',true),($1,$6,'kitchen','R4 Kitchen',true),($1,$4,'cashier','R4 Cashier',true) returning id,user_id,restaurant_id,role::text`,
      [tenant, managerUser, otherTenant, otherManagerUser, waiterUser, kitchenUser])).rows;
    const manager = staff.find((row) => row.user_id === managerUser);
    const waiter = staff.find((row) => row.user_id === waiterUser);
    const kitchen = staff.find((row) => row.user_id === kitchenUser);
    const cashier = staff.find((row) => row.restaurant_id === tenant && row.role === "cashier");
    const otherManager = staff.find((row) => row.restaurant_id === otherTenant);
    const category = id(), station = id(), item = id(), order = id();
    await db.query("insert into public.categories(id,restaurant_id,name) values($1,$2,'R4 Food')", [category,tenant]);
    await db.query("insert into public.kitchen_stations(id,restaurant_id,name,priority,active) values($1,$2,'R4 Kitchen',1,true)", [station,tenant]);
    await db.query("insert into public.menu_items(id,restaurant_id,category_id,name,price,available,kitchen_station_id) values($1,$2,$3,'R4 Dish',10,true,$4)", [item,tenant,category,station]);
    await db.query(`insert into public.orders(id,restaurant_id,status,total_price,created_at,table_number,created_by_waiter_id,dining_session_opened_at,dining_session_closed_at,order_source)
      values($1,$2,'completed',10,'2026-08-10T09:00Z','7',$3,'2026-08-10T09:00Z','2026-08-10T10:00Z','waiter')`, [order,tenant,waiter.id]);
    await db.query(`insert into public.order_items(id,restaurant_id,order_id,menu_item_id,quantity,price,created_at,kitchen_station_id,kitchen_status,kitchen_preparation_started_at,kitchen_preparation_started_by,kitchen_completed_at,kitchen_completed_by)
      values($1,$2,$3,$4,1,10,'2026-08-10T09:05Z',$5,'completed','2026-08-10T09:10Z',$6,'2026-08-10T09:40Z',$6)`, [id(),tenant,order,item,station,kitchen.id]);
    const comparisonOrder=id();
    await db.query(`insert into public.orders(id,restaurant_id,status,total_price,created_at,table_number,created_by_waiter_id,dining_session_opened_at,dining_session_closed_at,order_source)
      values($1,$2,'completed',10,'2026-08-09T09:00Z','8',$3,'2026-08-09T09:00Z','2026-08-09T09:45Z','waiter')`, [comparisonOrder,tenant,waiter.id]);
    await db.query(`insert into public.order_items(id,restaurant_id,order_id,menu_item_id,quantity,price,created_at,kitchen_station_id,kitchen_status,kitchen_preparation_started_at,kitchen_preparation_started_by,kitchen_completed_at,kitchen_completed_by)
      values($1,$2,$3,$4,1,10,'2026-08-09T09:05Z',$5,'completed','2026-08-09T09:10Z',$6,'2026-08-09T09:20Z',$6)`, [id(),tenant,comparisonOrder,item,station,kitchen.id]);
    const table = (await db.query("select id from public.restaurant_tables where restaurant_id=$1 and table_number=7", [tenant])).rows[0].id;
    await db.query("insert into public.waiter_assistance_requests(id,restaurant_id,order_id,table_id,status,requested_at) values($1,$2,$3,$4,'resolved','2026-08-10T09:20Z')", [id(),tenant,order,table]);
    await db.query("insert into public.manager_customer_complaints(id,restaurant_id,order_id,table_id,table_number,category,description,status,severity,created_at) values($1,$2,$3,$4,'7','Service','Audit complaint','open','medium','2026-08-10T09:25Z')", [id(),tenant,order,table]);
    await db.query("insert into public.public_order_feedback(id,restaurant_id,order_id,table_number,rating,created_at) values($1,$2,$3,'7',4,'2026-08-10T10:05Z')", [id(),tenant,order]);
    await db.query("insert into public.cashier_shifts(id,restaurant_id,opened_by,opened_at,opening_cash) values($1,$2,$3,'2026-08-10T08:00Z',100)", [id(),tenant,cashier.id]);
    const location=id(), unit=id(), inventoryCategory=id(), inventoryItem=id();
    await db.query("insert into public.inventory_categories(id,restaurant_id,name,created_by_staff_id) values($1,$2,'R4 Ingredients',$3)", [inventoryCategory,tenant,manager.id]);
    await db.query("insert into public.inventory_storage_locations(id,restaurant_id,name,created_by_staff_id) values($1,$2,'R4 Store',$3)", [location,tenant,manager.id]);
    await db.query("insert into public.inventory_units(id,restaurant_id,name,created_by_staff_id) values($1,$2,'kg',$3)", [unit,tenant,manager.id]);
    await db.query("insert into public.inventory_items(id,restaurant_id,name,unit,current_quantity,reorder_level,category_id,unit_id,storage_location_id,created_by_staff_id) values($1,$2,'R4 Chicken','kg',999,1,$3,$4,$5,$6)", [inventoryItem,tenant,inventoryCategory,unit,location,manager.id]);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [managerUser]);
    for (const [movementType,quantity,effect,time] of [["stock_in",10,"in","2026-08-10T08:00Z"],["stock_out",3,"out","2026-08-10T09:00Z"],["adjustment_decrease",1,"out","2026-08-10T10:00Z"],["waste",2,"out","2026-08-10T11:00Z"]]) {
      await db.query(`insert into public.inventory_movements(id,restaurant_id,inventory_item_id,storage_location_id,unit_id,unit_name,movement_type,quantity,quantity_effect,reason,movement_date,created_by_staff_id)
        values($1,$2,$3,$4,$5,'kg',$6,$7,$8,'R4 audit movement',$9,$10)`, [id(),tenant,inventoryItem,location,unit,movementType,quantity,effect,time,manager.id]);
    }
    const inventoryRequest=id();
    await db.query(`insert into public.kitchen_inventory_requests(id,restaurant_id,inventory_item_id,station_id,requested_by_staff_id,processed_by_staff_id,item_name,quantity,unit,status,requested_at,accepted_at,delivered_at)
      values($1,$2,$3,$4,$5,$5,'R4 Chicken',2,'kg','delivered','2026-08-10T08:30Z','2026-08-10T08:35Z','2026-08-10T08:40Z')`, [inventoryRequest,tenant,inventoryItem,station,kitchen.id]);
    await db.query("insert into public.inventory_request_events(id,restaurant_id,request_id,actor_staff_id,event_type,from_status,to_status,created_at) values($1,$2,$3,$4,'delivered','accepted','delivered','2026-08-10T08:40Z')", [id(),tenant,inventoryRequest,kitchen.id]);

    const args = [tenant,"2026-08-10T00:00:00Z","2026-08-11T00:00:00Z","2026-08-09T00:00:00Z","2026-08-10T00:00:00Z"];
    const report = await asActor(managerUser,"get_manager_operational_report",args);
    check("A","correct preparation duration",Number(report.kitchen.current.avg_minutes)===30);
    check("B","station and menu aggregation",report.kitchen.stations[0].station_name==="R4 Kitchen" && report.kitchen.menu_items[0].menu_item_name==="R4 Dish");
    check("C","delayed-item handling",report.kitchen.current.delayed_items===1 && report.kitchen.delay_threshold_minutes===25);
    check("D","comparison isolation",Number(report.kitchen.comparison.avg_minutes)===10 && report.kitchen.comparison.delayed_items===0);
    check("E","waiter activity attribution",report.staff.facts.some((row)=>row.id===waiter.id && row.orders_created===1 && row.comparison_orders_created===1));
    check("F","cashier activity attribution",report.staff.facts.some((row)=>row.id===cashier.id && row.cashier_shifts_opened===1));
    check("G","no invented performance score",report.staff.score_available===false && !JSON.stringify(report.staff.facts).includes("score"));
    check("H","cross-tenant staff isolation",!report.staff.facts.some((row)=>row.id===otherManager.id));
    check("I","receipt movement",report.inventory.current.quantity_in==="10.000" || Number(report.inventory.current.quantity_in)===10);
    check("J","deduction movement",Number(report.inventory.current.quantity_out)===6);
    check("K","adjustment and waste preserved",report.inventory.movements.some((row)=>row.movement_type==="adjustment_decrease") && Number(report.inventory.current.waste_spoilage)===2);
    check("L","request fulfillment preserved",report.inventory.requests.some((row)=>row.id===inventoryRequest && row.status==="delivered"));
    check("M","no reconstruction from current quantity",report.data_quality.inventory_history_quality==="mixed_legacy" && report.data_quality.inventory_history_scope==="movement_ledger_only" && !JSON.stringify(report.inventory).includes("current_quantity") && !JSON.stringify(report.inventory).includes("999"));
    check("N","dining session count",report.guests.current.sessions_opened===1 && report.guests.current.sessions_closed===1);
    check("O","session duration",Number(report.guests.current.avg_session_minutes)===60);
    check("P","complaint and request activity",Number(report.guests.assistance_requests)===1 && Number(report.guests.complaints)===1 && report.exceptions.native.some((row)=>row.source_type==="complaint"));
    check("Q","orders not falsely treated as guest count",report.guests.guest_count_available===false && report.guests.guest_count===undefined);
    const incidentId = await asActor(managerUser,"create_manager_report_incident",[tenant,"service_issue","manual",null,"high","Audit incident","Observed issue","2026-08-10T11:00:00Z",waiter.id]);
    const withOpen = await asActor(managerUser,"get_manager_operational_report",args);
    check("R","valid incident creation and read",typeof incidentId==="string" && withOpen.exceptions.manual.some((row)=>row.id===incidentId && row.status==="open"));
    const decision = await asActor(managerUser,"record_manager_incident_decision",[incidentId,"resolved","Corrective action recorded","resolved",waiter.id,"Issue verified and resolved"]);
    check("S","manager resolution and decision",decision.status==="resolved");
    check("T","unauthorized actor denied",await denied(waiterUser,"create_manager_report_incident",[tenant,"x","manual",null,"attention","No","Denied","2026-08-10T11:00:00Z",null]));
    check("U","cross-tenant incident/report denied",await denied(otherManagerUser,"get_manager_operational_report",args));
    const noteId = await asActor(managerUser,"create_manager_operational_note",[tenant,"Operational follow-up","2026-08-10","2026-08-10T00:00:00Z","2026-08-11T00:00:00Z"]);
    check("V","decision attribution and manager note preserved",typeof noteId==="string");
    const refreshed = await asActor(managerUser,"get_manager_operational_report",args);
    check("W","resolved/open statuses preserved",refreshed.manager_records.decisions.some((row)=>row.manager_staff_id===manager.id && row.resulting_status==="resolved") && refreshed.manager_records.notes.length===1 && refreshed.exceptions.manual.some((row)=>row.id===incidentId && row.status==="resolved"));
    await db.query("rollback");
  } catch (error) { await db.query("rollback"); throw error; }
  finally { await db.end(); }
  for (const row of results) console.log(`${row.ok ? "PASS" : "FAIL"} ${row.letter} ${row.label}${row.detail ? ` - ${row.detail}` : ""}`);
  const passed=results.filter((row)=>row.ok).length;
  console.log(`R4 hosted rollback audit: ${passed}/${results.length} passed; all fixtures rolled back.`);
  if (passed!==results.length) process.exitCode=1;
}

main().catch((error)=>{ console.error(error); process.exitCode=1; });
