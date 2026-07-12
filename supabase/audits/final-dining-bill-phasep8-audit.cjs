const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const root = __dirname;
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const checks = [];

function check(label, ok, detail = "") {
  checks.push({ label, ok: Boolean(ok), detail });
}

function includesAll(source, needles) {
  return needles.every((needle) => source.includes(needle));
}

const cashier = read("src/modules/cashier/pages/CashierDashboardPage.tsx");
const owner = read("src/modules/owner/pages/OwnerDashboardPage.tsx");
const migration = read("supabase/migrations/081_final_dining_bill_phasep8.sql");

check("One dining session -> one bill", migration.includes("unique (restaurant_id, dining_session_id)") && migration.includes("on conflict (restaurant_id, dining_session_id)"));
check("Multiple payment batches -> one bill", migration.includes("sum(invoices.total_price)") && migration.includes("group by coalesce(public.normalize_payment_method"));
check("Reprint increments existing bill", migration.includes("print_count = print_count + 1") && migration.includes("where id = existing_bill.id"));
check("Thermal rendering supports 58mm and 80mm", cashier.includes('"58mm"') && cashier.includes('"80mm"') && cashier.includes("Thermal"));
check("Browser rendering supported", cashier.includes('"browser"') && cashier.includes("Browser Print"));
check("A4 rendering supported", cashier.includes('"a4"') && cashier.includes("A4"));
check("Automatic page break", cashier.includes("chunkBillItems") && cashier.includes("Continue on page") && cashier.includes("lastPage ?"));
check("Totals final page only", cashier.includes("const totalsHtml = lastPage ?") && cashier.includes("<footer>") && cashier.includes(": `<div class=\"continue\""));
check("Ethiopian bill header fields", includesAll(cashier, ["Restaurant/Cafe Bill", "TIN:", "VAT Number:", "Tel:", "Bill #", "Receipt #", "Session", "Table", "Waiter", "Cashier", "Date", "Time"]));
check("Payment breakdown fields", includesAll(cashier, ["Payment Breakdown", "Cash", "Telebirr", "CBE Birr", "Card", "Chapa", "Other", "Total Paid"]));
check("VAT calculation and reporting", migration.includes("vat_rate numeric := 0.15") && migration.includes("bill_vat_amount") && owner.includes("vat_collected") && owner.includes("VAT Collected"));
check("Print count surfaced", migration.includes("print_count") && cashier.includes("Print Count") && owner.includes("Print Count"));
check("Bill numbering", migration.includes("dining_session_bill_counters") && migration.includes("bill_prefix || '-' || lpad"));
check("Owner metrics from dining_session_bills", owner.includes('.from("dining_session_bills")') && includesAll(owner, ["Bills Printed Today", "Bills Reprinted Today", "Average Bill", "Largest Bill", "Daily Bill Count", "Monthly Bill Count", "Top Bills"]));
check("No duplicate bills", migration.includes("dining_session_bills_session_unique") && migration.includes("unique (restaurant_id, dining_session_id)"));
check("No duplicate bill numbers", migration.includes("dining_session_bills_number_unique") && migration.includes("unique (restaurant_id, bill_number)"));
check("Bill survives session closure", migration.includes("references public.orders(id) on delete restrict") && cashier.includes("close_dining_session"));
check("Pending payment blocks print", migration.includes("Cannot print final bill while a payment batch is pending or unverified."));
check("Kitchen incomplete blocks print", migration.includes("Cannot print final bill while kitchen items remain incomplete."));
check("Release table remains explicit", cashier.includes("Release Table") && !cashier.includes("await handleCloseDiningSessionFromBill();"));

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
  console.error(`\nPhase P8 audit failed: ${failed.length} check(s) failed.`);
  process.exit(1);
}

console.log("\nPhase P8 audit passed.");
