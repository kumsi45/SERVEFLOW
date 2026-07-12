const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const root = path.join(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const migration = read("supabase/migrations/082_phase_p75_final_dining_session_lifecycle.sql");
const p7Migration = read("supabase/migrations/078_phase_p7_dining_session_finalization.sql");
const p8Migration = read("supabase/migrations/081_final_dining_bill_phasep8.sql");
const publicQrContext = read("src/modules/public-qr-ordering/services/publicQrContext.ts");
const publicQrService = read("src/modules/public-qr-ordering/services/publicQrOrderService.ts");
const qrMenuPage = read("src/modules/qr-menu/pages/QRMenuPage.tsx");
const cashier = read("src/modules/cashier/pages/CashierDashboardPage.tsx");
const owner = read("src/modules/owner/pages/OwnerDashboardPage.tsx");
const kitchen = read("src/modules/kitchen/pages/KitchenDashboardPage.tsx");

const checks = [];

function check(label, ok, detail = "") {
  checks.push({ label, ok: Boolean(ok), detail });
}

function includesAll(source, needles) {
  return needles.every((needle) => source.includes(needle));
}

check(
  "Browser session token is explicit and local",
  publicQrContext.includes("browserSessionToken") &&
    publicQrContext.includes("window.sessionStorage") &&
    publicQrService.includes("browser_session_token: browserSessionToken ?? \"\"") &&
    qrMenuPage.includes("browserSessionToken: checkout.browserSessionToken")
);

check(
  "No forbidden customer detection source",
  !/\b(ip_address|client_ip|mac_address|fingerprint|user_agent)\b/i.test(migration)
);

check(
  "Different browser receives active-session conflict unless eligible",
  migration.includes("This table currently has an active dining session.") &&
    migration.includes("active_order.browser_session_token is distinct from normalized_browser_session_token") &&
    migration.includes("public.is_dining_session_auto_releasable(active_order.id)")
);

check(
  "Automatic release requires timeout, verified batches, served kitchen, and no pending batches",
  includesAll(migration, [
    "inactivity_deadline >= now()",
    "invoices.status in ('pending', 'paid', 'rejected')",
    "invoices.status not in ('verified', 'cancelled', 'refunded')",
    "items.kitchen_status <> 'completed'",
    "auto_released_for_new_browser_scan",
  ])
);

check(
  "Unlimited additional orders remain separate payment batches",
  p7Migration.includes("select coalesce(max(invoice_number), 0) + 1") &&
    p7Migration.includes("insert into public.order_invoices") &&
    migration.includes("select coalesce(max(invoice_number), 0) + 1") &&
    migration.includes("insert into public.order_invoices")
);

check(
  "One final bill per dining session aggregates verified batches",
  p8Migration.includes("unique (restaurant_id, dining_session_id)") &&
    p8Migration.includes("sum(invoices.total_price)") &&
    p8Migration.includes("group by coalesce(public.normalize_payment_method")
);

check(
  "Manual release wording is Release Table",
  cashier.includes("Release Table") &&
    !cashier.includes("Close Order") &&
    !cashier.includes("Complete Order")
);

check(
  "Cashier queues classify sessions by dining_session_status",
  cashier.includes("return order.diningSessionStatus === \"open\";") &&
    cashier.includes("return order.diningSessionStatus === \"closed\" || order.diningSessionStatus === \"checked_out\";") &&
    cashier.includes("Pending Payments") &&
    cashier.includes("Active Orders") &&
    cashier.includes("Completed Orders")
);

check(
  "Owner table occupancy uses dining_session_status",
  owner.includes("const activeTableOrders = orders.filter((order) => order.dining_session_status === \"open\");") &&
    owner.includes("const activeTables = new Set(activeTableOrders.map((order) => order.table_number).filter(Boolean));") &&
    !/activeTableOrders\s*=\s*orders\.filter\(\(order\)\s*=>\s*ACTIVE_ORDER_STATUSES/.test(owner)
);

check(
  "No stale session reuse after release",
  migration.includes("public.is_public_qr_dining_session_open(orders.id)") &&
    migration.includes("table_released_at") &&
    migration.includes("active_order := null")
);

check(
  "Realtime synchronization remains wired",
  cashier.includes("supabase.channel(`cashier-operations-${restaurantId}`)") &&
    owner.includes(".channel(`owner-${restaurantId}`)") &&
    kitchen.includes("supabase.channel(`kitchen-${restaurantId}-${selectedStationId}`)")
);

let buildOk = false;
let buildOutput = "";
try {
  buildOutput = childProcess.execSync("npm run build", { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  buildOk = true;
} catch (error) {
  buildOutput = `${error.stdout || ""}\n${error.stderr || ""}`.trim();
}
check("Build passes", buildOk, buildOk ? "npm run build passed" : buildOutput);

const failed = checks.filter((item) => !item.ok);
for (const item of checks) {
  console.log(`${item.ok ? "PASS" : "FAIL"}: ${item.label}${item.detail && !item.ok ? `\n  ${item.detail}` : ""}`);
}

if (failed.length > 0) {
  console.error(`\nPhase P7.5 audit failed: ${failed.length} check(s) failed.`);
  process.exit(1);
}

console.log("\nPhase P7.5 audit passed.");
