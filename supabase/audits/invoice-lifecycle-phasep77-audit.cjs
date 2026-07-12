const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..");
const migration = fs.readFileSync(path.join(root, "supabase", "migrations", "084_phase_p77_invoice_lifecycle_ownership.sql"), "utf8");
const cashierPage = fs.readFileSync(path.join(root, "src", "modules", "cashier", "pages", "CashierDashboardPage.tsx"), "utf8");
const cashierTypes = fs.readFileSync(path.join(root, "src", "modules", "cashier", "types.ts"), "utf8");

const checks = [
  {
    label: "Invoice owns source and creator columns",
    ok: /add column if not exists invoice_source text/.test(migration)
      && /add column if not exists created_by_staff_id uuid/.test(migration)
      && /add column if not exists created_by_display_name text/.test(migration),
  },
  {
    label: "Invoice source is constrained to request origins",
    ok: /invoice_source is null or invoice_source in \('public_qr', 'waiter', 'cashier', 'authenticated', 'unknown'\)/.test(migration),
  },
  {
    label: "Invoice kitchen status is derived from invoice payment and invoice items only",
    ok: /create or replace function public\.invoice_kitchen_status\(target_invoice_id uuid\)/.test(migration)
      && /invoice\.id = items\.invoice_id/.test(migration)
      && !/orders\.status/.test(migration.match(/create or replace function public\.invoice_kitchen_status[\s\S]*?\$\$;/)?.[0] ?? ""),
  },
  {
    label: "QR invoice stamps Customer QR on current invoice",
    ok: /stamp_invoice_ownership\(\(payload->>'invoice_id'\)::uuid, 'public_qr', null, 'Customer QR'\)/.test(migration),
  },
  {
    label: "Waiter invoice stamps current waiter only",
    ok: /create_waiter_order_p77_base/.test(migration)
      && /role::text = 'waiter'/.test(migration)
      && /stamp_invoice_ownership\(\s*target_invoice\.id,\s*'waiter',\s*acting_waiter\.id,\s*acting_waiter\.display_name/s.test(migration),
  },
  {
    label: "Cashier create and append stamp cashier on current invoice",
    ok: /create_cashier_order_p77_base/.test(migration)
      && /append_items_to_order_p77_base/.test(migration)
      && /stamp_invoice_ownership\(\(payload->>'invoice_id'\)::uuid, 'cashier', acting_staff\.id, acting_staff\.display_name\)/.test(migration)
      && /stamp_invoice_ownership\(target_invoice\.id, 'cashier', acting_staff\.id, acting_staff\.display_name\)/.test(migration),
  },
  {
    label: "Cashier queue returns invoice-owned creator and kitchen status",
    ok: /invoice_source text/.test(migration)
      && /invoice_creator_name text/.test(migration)
      && /invoice_kitchen_status text/.test(migration)
      && /public\.invoice_kitchen_status\(invoices\.id\) as invoice_kitchen_status/.test(migration),
  },
  {
    label: "Cashier UI uses invoice kitchen status, not order status",
    ok: /invoiceKitchenStatus/.test(cashierTypes)
      && /statusLabel\(order\.invoiceKitchenStatus \|\| "waiting_payment"\)/.test(cashierPage)
      && /statusLabel\(batch\.invoiceKitchenStatus \|\| "waiting_payment"\)/.test(cashierPage),
  },
  {
    label: "Cashier UI shows invoice creator per batch",
    ok: /invoiceCreatorName/.test(cashierTypes)
      && /creatorLabel\(order\)/.test(cashierPage)
      && /creatorLabel\(batch\)/.test(cashierPage),
  },
];

let failed = 0;
for (const check of checks) {
  if (check.ok) {
    console.log(`PASS ${check.label}`);
  } else {
    failed += 1;
    console.error(`FAIL ${check.label}`);
  }
}

console.log(`Passed: ${checks.length - failed}`);
console.log(`Failed: ${failed}`);
if (failed) process.exit(1);
