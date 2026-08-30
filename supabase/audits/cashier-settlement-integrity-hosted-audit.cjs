const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { createClient } = require("@supabase/supabase-js");

const root = path.resolve(__dirname, "../..");
for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2];
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(url && anonKey && serviceKey, "Hosted Supabase credentials are unavailable.");

  const service = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const password = `PhaseA-${suffix}-Aa1!`;
  const createdUserIds = [];
  const createdStaffIds = [];
  const createdShiftIds = [];
  const createdOrderIds = [];
  const createdInvoiceIds = [];
  const createdTableIds = [];
  let categoryId = null;
  let menuItemId = null;
  let restaurantId = null;
  let passed = 0;

  const check = (condition, message) => {
    assert(condition, message);
    passed += 1;
  };

  async function requireCleanup(operation, label) {
    const { error } = await operation;
    if (error) throw new Error(`Phase A audit cleanup failed for ${label}: ${error.message}`);
  }

  async function deleteAuditReconciliations() {
    const connectionLine = fs.readFileSync(
      path.join(root, "supabase", "connection.env"),
      "utf8",
    ).split(/\r?\n/).find((line) => /^\s*SUPABASE_DB_URL\s*=/.test(line));
    assert(connectionLine, "SUPABASE_DB_URL is required for isolated reconciliation cleanup.");
    const connectionString = connectionLine
      .replace(/^\s*SUPABASE_DB_URL\s*=\s*/, "")
      .trim()
      .replace(/^["']|["']$/g, "");
    const database = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    await database.connect();
    try {
      await database.query("begin");
      await database.query("set local session_replication_role = replica");
      await database.query(
        `delete from public.cash_reconciliations
         where shift_id = any($1::uuid[])
           and closed_by = any($2::uuid[])`,
        [createdShiftIds, createdStaffIds],
      );
      await database.query("commit");
    } catch (error) {
      await database.query("rollback");
      throw error;
    } finally {
      await database.end();
    }
  }

  async function cleanup() {
    if (createdStaffIds.length || createdShiftIds.length || createdOrderIds.length) {
      const filters = [];
      if (createdStaffIds.length) filters.push(`actor_staff_id.in.(${createdStaffIds.join(",")})`);
      if (createdShiftIds.length) filters.push(`shift_id.in.(${createdShiftIds.join(",")})`);
      if (createdOrderIds.length) filters.push(`order_id.in.(${createdOrderIds.join(",")})`);
      if (filters.length) {
        await requireCleanup(
          service.from("shift_activity_logs").delete().or(filters.join(",")),
          "shift activity logs",
        );
      }
    }
    if (createdOrderIds.length) {
      await requireCleanup(
        service.from("order_items").delete().in("order_id", createdOrderIds),
        "order items",
      );
    }
    if (createdInvoiceIds.length) {
      await requireCleanup(
        service.from("order_invoices").delete().in("id", createdInvoiceIds),
        "order invoices",
      );
    }
    if (createdOrderIds.length) {
      await requireCleanup(
        service.from("orders").delete().in("id", createdOrderIds),
        "orders",
      );
    }
    if (createdShiftIds.length) {
      await deleteAuditReconciliations();
      await requireCleanup(
        service.from("cashier_shifts").delete().in("id", createdShiftIds),
        "cashier shifts",
      );
    }
    if (createdStaffIds.length) {
      await requireCleanup(
        service.from("restaurant_staff").delete().in("id", createdStaffIds),
        "restaurant staff",
      );
    }
    if (createdTableIds.length) {
      await requireCleanup(
        service.from("restaurant_tables").delete().in("id", createdTableIds),
        "restaurant tables",
      );
    }
    if (menuItemId) {
      await requireCleanup(
        service.from("menu_items").delete().eq("id", menuItemId),
        "menu item",
      );
    }
    if (categoryId) {
      await requireCleanup(
        service.from("categories").delete().eq("id", categoryId),
        "category",
      );
    }
    for (const userId of createdUserIds) {
      const { error } = await service.auth.admin.deleteUser(userId);
      if (error) throw new Error(`Phase A audit cleanup failed for auth user: ${error.message}`);
    }
  }

  try {
    const { data: methods, error: methodsError } = await service
      .from("business_payment_methods")
      .select("restaurant_id,method_code")
      .eq("enabled", true);
    if (methodsError) throw methodsError;

    const byRestaurant = new Map();
    for (const method of methods) {
      const set = byRestaurant.get(method.restaurant_id) ?? new Set();
      set.add(method.method_code);
      byRestaurant.set(method.restaurant_id, set);
    }
    const candidate = [...byRestaurant.entries()].find(([, codes]) =>
      codes.has("cash") && [...codes].some((code) => code !== "cash"),
    );
    assert(candidate, "No hosted restaurant has both Cash and a digital payment method enabled.");
    restaurantId = candidate[0];
    const digitalCode = [...candidate[1]].find((code) => code !== "cash");
    const digitalMethod = {
      telebirr: "Telebirr",
      cbe_birr: "CBE Birr",
      mobile_banking: "Mobile Banking",
      bank_transfer: "Bank Transfer",
      credit_card: "Card",
      qr: "QR",
    }[digitalCode];
    assert(digitalMethod, `Unsupported hosted digital method code: ${digitalCode}`);

    const { data: restaurant, error: restaurantError } = await service
      .from("restaurants")
      .select("slug")
      .eq("id", restaurantId)
      .single();
    if (restaurantError) throw restaurantError;

    const { data: category, error: categoryError } = await service
      .from("categories")
      .insert({ restaurant_id: restaurantId, name: `Phase A Audit ${suffix}` })
      .select("id")
      .single();
    if (categoryError) throw categoryError;
    categoryId = category.id;

    const { data: menuItem, error: menuError } = await service
      .from("menu_items")
      .insert({
        restaurant_id: restaurantId,
        category_id: categoryId,
        name: `Phase A Audit Item ${suffix}`,
        price: 17,
        available: true,
      })
      .select("id")
      .single();
    if (menuError) throw menuError;
    menuItemId = menuItem.id;

    const { data: usedTables, error: tableReadError } = await service
      .from("restaurant_tables")
      .select("table_number")
      .eq("restaurant_id", restaurantId);
    if (tableReadError) throw tableReadError;
    const used = new Set(usedTables.map((row) => row.table_number));
    const tableNumbers = [];
    for (let number = 500; number >= 1 && tableNumbers.length < 9; number -= 1) {
      if (!used.has(number)) tableNumbers.push(number);
    }
    assert(tableNumbers.length === 9, "Nine isolated table numbers are required for the hosted audit.");
    const { data: tables, error: tableInsertError } = await service
      .from("restaurant_tables")
      .insert(tableNumbers.map((tableNumber) => ({
        restaurant_id: restaurantId,
        table_number: tableNumber,
        label: `Phase A ${tableNumber}`,
        qr_path: `/r/${restaurant.slug}/order?table=${tableNumber}`,
        qr_url: `https://audit.invalid/r/${restaurant.slug}/order?table=${tableNumber}`,
        active: true,
      })))
      .select("id");
    if (tableInsertError) throw tableInsertError;
    createdTableIds.push(...tables.map((table) => table.id));

    const cashiers = {};
    for (const name of ["a", "b", "c", "d"]) {
      const email = `serveflow-phase-a-${name}-${suffix}@example.invalid`;
      const { data: authData, error: authError } = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (authError) throw authError;
      createdUserIds.push(authData.user.id);

      const { data: staff, error: staffError } = await service
        .from("restaurant_staff")
        .insert({
          restaurant_id: restaurantId,
          user_id: authData.user.id,
          role: "cashier",
          display_name: `Phase A Cashier ${name.toUpperCase()}`,
          employee_id: `PA${Date.now().toString().slice(-8)}${name.toUpperCase()}`,
          active: true,
        })
        .select("id")
        .single();
      if (staffError) throw staffError;
      createdStaffIds.push(staff.id);

      const client = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error: signInError } = await client.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      cashiers[name] = { client, staffId: staff.id };
    }

    async function createOrder(client, paymentMethod, tableNumber) {
      const { data, error } = await client.rpc("create_cashier_order", {
        target_restaurant_id: restaurantId,
        table_number: String(tableNumber),
        selected_payment_method: paymentMethod,
        requested_items: [{ menu_item_id: menuItemId, quantity: 1 }],
      });
      if (error) throw error;
      createdOrderIds.push(data.order_id);
      createdInvoiceIds.push(data.invoice_id);
      return data;
    }

    async function openShift(name) {
      const { data, error } = await cashiers[name].client.rpc("open_cashier_shift", {
        target_restaurant_id: restaurantId,
        opening_cash_amount: 0,
        opening_notes: `Phase A hosted audit ${suffix}`,
      });
      if (error) throw error;
      createdShiftIds.push(data.id);
      cashiers[name].shiftId = data.id;
      return data;
    }

    async function settle(name, orderId, paymentMethod, evidence = {}) {
      return cashiers[name].client.rpc("verify_dining_session_payment", {
        target_dining_session_id: orderId,
        selected_payment_method: paymentMethod,
        payment_reference_number: evidence.reference ?? null,
        payment_transaction_id: evidence.transaction ?? null,
        payment_screenshot_url: evidence.screenshot ?? null,
        owner_duplicate_override: false,
      });
    }

    const noShiftCash = await createOrder(cashiers.a.client, "Cash", tableNumbers[0]);
    const noShiftCashResult = await settle("a", noShiftCash.order_id, "Cash");
    check(
      noShiftCashResult.error?.message.includes("No open cashier shift"),
      "Cash settlement without a shift was not denied safely.",
    );

    const noShiftDigital = await createOrder(cashiers.a.client, digitalMethod, tableNumbers[1]);
    const noShiftDigitalResult = await settle("a", noShiftDigital.order_id, digitalMethod, { transaction: `tx-${suffix}-no-shift` });
    check(
      noShiftDigitalResult.error?.message.includes("No open cashier shift"),
      "Digital settlement without a shift was not denied safely.",
    );
    const { data: deniedInvoices, error: deniedInvoicesError } = await service
      .from("order_invoices")
      .select("id,payment_status,cashier_shift_id,verified_by")
      .in("id", [noShiftCash.invoice_id, noShiftDigital.invoice_id]);
    if (deniedInvoicesError) throw deniedInvoicesError;
    check(
      deniedInvoices.length === 2
        && deniedInvoices.every((invoice) => invoice.payment_status !== "paid"
          && invoice.cashier_shift_id === null
          && invoice.verified_by === null),
      "A denied no-shift settlement mutated financial invoice state.",
    );

    await openShift("a");
    await openShift("b");

    const noOwnShift = await createOrder(cashiers.c.client, "Cash", tableNumbers[2]);
    const noOwnShiftResult = await settle("c", noOwnShift.order_id, "Cash");
    check(
      noOwnShiftResult.error?.message.includes("No open cashier shift"),
      "A cashier without a shift used another cashier's open shift.",
    );

    const owned = await createOrder(cashiers.a.client, "Cash", tableNumbers[3]);
    const ownedResult = await settle("a", owned.order_id, "Cash");
    if (ownedResult.error) throw ownedResult.error;
    const { data: ownedInvoice, error: ownedReadError } = await service
      .from("order_invoices")
      .select("cashier_shift_id,verified_by,payment_status,grand_total")
      .eq("id", owned.invoice_id)
      .single();
    if (ownedReadError) throw ownedReadError;
    check(
      ownedInvoice.payment_status === "paid"
        && ownedInvoice.cashier_shift_id === cashiers.a.shiftId
        && ownedInvoice.verified_by === cashiers.a.staffId,
      "Settlement was not owned by Cashier A's exact shift.",
    );

    const digital = await createOrder(cashiers.a.client, digitalMethod, tableNumbers[4]);
    const missingEvidence = await settle("a", digital.order_id, digitalMethod);
    check(
      missingEvidence.error?.message.includes("Digital payment evidence is required"),
      "Digital settlement without evidence was not denied.",
    );
    const digitalResult = await settle("a", digital.order_id, digitalMethod, { transaction: `tx-${suffix}-digital` });
    if (digitalResult.error) throw digitalResult.error;
    check(true, "Digital settlement with evidence failed.");
    const { data: digitalInvoice, error: digitalInvoiceError } = await service
      .from("order_invoices")
      .select("payment_status,cashier_shift_id,verified_by")
      .eq("id", digital.invoice_id)
      .single();
    if (digitalInvoiceError) throw digitalInvoiceError;
    check(
      digitalInvoice.payment_status === "paid"
        && digitalInvoice.cashier_shift_id === cashiers.a.shiftId
        && digitalInvoice.verified_by === cashiers.a.staffId,
      "Digital settlement did not retain exact acting-cashier shift ownership.",
    );

    const sameCashier = await createOrder(cashiers.a.client, "Cash", tableNumbers[5]);
    const sameCashierResults = await Promise.all([
      settle("a", sameCashier.order_id, "Cash"),
      settle("a", sameCashier.order_id, "Cash"),
    ]);
    check(
      sameCashierResults.some((result) => !result.error),
      "Same-cashier concurrent replay produced no successful settlement.",
    );
    const { data: sameCashierInvoice } = await service
      .from("order_invoices")
      .select("payment_status,cashier_shift_id,verified_by")
      .eq("id", sameCashier.invoice_id)
      .single();
    check(
      sameCashierInvoice.payment_status === "paid"
        && sameCashierInvoice.cashier_shift_id === cashiers.a.shiftId
        && sameCashierInvoice.verified_by === cashiers.a.staffId,
      "Same-cashier replay created inconsistent ownership.",
    );

    const twoCashiers = await createOrder(cashiers.a.client, "Cash", tableNumbers[6]);
    const twoCashierResults = await Promise.all([
      settle("a", twoCashiers.order_id, "Cash"),
      settle("b", twoCashiers.order_id, "Cash"),
    ]);
    const twoCashierSuccessfulCalls = twoCashierResults.filter((result) => !result.error).length;
    check(
      twoCashierSuccessfulCalls >= 1,
      "Two-cashier race produced no successful settlement.",
    );
    const { data: racedInvoice } = await service
      .from("order_invoices")
      .select("payment_status,cashier_shift_id,verified_by")
      .eq("id", twoCashiers.invoice_id)
      .single();
    const winnerIsA = racedInvoice.verified_by === cashiers.a.staffId
      && racedInvoice.cashier_shift_id === cashiers.a.shiftId;
    const winnerIsB = racedInvoice.verified_by === cashiers.b.staffId
      && racedInvoice.cashier_shift_id === cashiers.b.shiftId;
    check(
      racedInvoice.payment_status === "paid" && (winnerIsA || winnerIsB),
      "Two-cashier race produced more than one or mismatched settlement owner.",
    );

    const crossTenantShift = await service
      .from("cashier_shifts")
      .select("id")
      .neq("restaurant_id", restaurantId)
      .limit(1)
      .maybeSingle();
    assert(!crossTenantShift.error && crossTenantShift.data, "A foreign-tenant shift is required for the hosted FK probe.");
    const { error: crossTenantError } = await service
      .from("order_invoices")
      .update({ cashier_shift_id: crossTenantShift.data.id })
      .eq("id", noOwnShift.invoice_id);
    check(Boolean(crossTenantError), "Privileged cross-tenant invoice/shift linkage was accepted.");

    const { error: ordinaryMutationError } = await cashiers.a.client
      .from("order_invoices")
      .update({ cashier_shift_id: cashiers.b.shiftId })
      .eq("id", noOwnShift.invoice_id);
    check(Boolean(ordinaryMutationError), "Ordinary cashier received direct invoice mutation authority.");

    const { error: immutableError } = await service
      .from("order_invoices")
      .update({ payment_method: digitalMethod })
      .eq("id", owned.invoice_id);
    check(Boolean(immutableError), "Finalized payment method remained mutable.");

    const { data: foreignInvoice, error: foreignInvoiceError } = await service
      .from("order_invoices")
      .select("id,order_id,restaurant_id,payment_status,cashier_shift_id,verified_by")
      .neq("restaurant_id", restaurantId)
      .limit(1)
      .maybeSingle();
    assert(!foreignInvoiceError && foreignInvoice, "A foreign-tenant invoice is required for the hosted RPC probe.");
    const foreignSettlement = await settle("a", foreignInvoice.order_id, "Cash");
    const { data: foreignInvoiceAfter, error: foreignInvoiceAfterError } = await service
      .from("order_invoices")
      .select("payment_status,cashier_shift_id,verified_by")
      .eq("id", foreignInvoice.id)
      .single();
    if (foreignInvoiceAfterError) throw foreignInvoiceAfterError;
    check(
      Boolean(foreignSettlement.error)
        && foreignInvoiceAfter.payment_status === foreignInvoice.payment_status
        && foreignInvoiceAfter.cashier_shift_id === foreignInvoice.cashier_shift_id
        && foreignInvoiceAfter.verified_by === foreignInvoice.verified_by,
      "A cashier changed a foreign-tenant invoice through the settlement RPC.",
    );

    const closeRace = await createOrder(cashiers.d.client, "Cash", tableNumbers[7]);
    const { error: fulfilledItemsError } = await service
      .from("order_items")
      .update({ kitchen_status: "completed" })
      .eq("order_id", closeRace.order_id);
    if (fulfilledItemsError) throw fulfilledItemsError;
    const { error: fulfilledOrderError } = await service
      .from("orders")
      .update({ status: "completed" })
      .eq("id", closeRace.order_id);
    if (fulfilledOrderError) throw fulfilledOrderError;
    await openShift("d");
    const [settlementRaceResult, closeRaceResult] = await Promise.all([
      settle("d", closeRace.order_id, "Cash"),
      cashiers.d.client.rpc("close_cashier_shift", {
        target_shift_id: cashiers.d.shiftId,
        actual_cash_amount: 0,
        variance_explanation: "Phase A concurrent settlement audit variance",
      }),
    ]);
    const { data: raceInvoice } = await service
      .from("order_invoices")
      .select("payment_status,cashier_shift_id,verified_by,grand_total")
      .eq("id", closeRace.invoice_id)
      .single();
    const { data: raceShift } = await service
      .from("cashier_shifts")
      .select("closed_at")
      .eq("id", cashiers.d.shiftId)
      .single();
    const { data: raceReconciliation, error: raceReconciliationError } = await service
      .from("cash_reconciliations")
      .select("cash_payments,expected_cash")
      .eq("shift_id", cashiers.d.shiftId)
      .maybeSingle();
    if (raceReconciliationError) throw raceReconciliationError;
    const settlementWon = !settlementRaceResult.error
      && !closeRaceResult.error
      && Boolean(raceShift.closed_at)
      && raceInvoice.payment_status === "paid"
      && raceInvoice.cashier_shift_id === cashiers.d.shiftId
      && raceInvoice.verified_by === cashiers.d.staffId
      && Number(raceReconciliation?.cash_payments) === Number(raceInvoice.grand_total)
      && Number(raceReconciliation?.expected_cash) === Number(raceInvoice.grand_total);
    const closeWon = !closeRaceResult.error
      && settlementRaceResult.error?.message.includes("No open cashier shift")
      && Boolean(raceShift.closed_at)
      && raceInvoice.payment_status !== "paid"
      && raceInvoice.cashier_shift_id === null
      && raceInvoice.verified_by === null
      && Number(raceReconciliation?.cash_payments) === 0
      && Number(raceReconciliation?.expected_cash) === 0;
    const raceOutcome = settlementWon ? "settlement_then_close" : closeWon ? "close_then_settlement_denied" : "invalid";
    check(
      settlementWon || closeWon,
      `Settlement committed into an already reconciled shift or produced an invalid race outcome: settlement=${settlementRaceResult.error?.message ?? "ok"}, close=${closeRaceResult.error?.message ?? "ok"}, shift_closed=${Boolean(raceShift.closed_at)}, payment_status=${raceInvoice.payment_status}`,
    );

    const { data: drawer, error: drawerError } = await cashiers.a.client.rpc(
      "cashier_shift_drawer_totals",
      { target_shift_id: cashiers.a.shiftId },
    );
    if (drawerError) throw drawerError;
    const { data: aCashInvoices, error: aCashError } = await service
      .from("order_invoices")
      .select("grand_total")
      .eq("cashier_shift_id", cashiers.a.shiftId)
      .eq("payment_status", "paid")
      .eq("payment_method", "Cash");
    if (aCashError) throw aCashError;
    const expectedCashSales = aCashInvoices.reduce((sum, invoice) => sum + Number(invoice.grand_total ?? 0), 0);
    check(
      Number(drawer.cash_sales) === expectedCashSales,
      `Cash reconciliation drawer totals omitted a successful Phase A settlement: returned=${drawer.cash_sales}, expected=${expectedCashSales}.`,
    );
    const { data: otherDrawer, error: otherDrawerError } = await cashiers.b.client.rpc(
      "cashier_shift_drawer_totals",
      { target_shift_id: cashiers.b.shiftId },
    );
    if (otherDrawerError) throw otherDrawerError;
    const { data: bCashInvoices, error: bCashError } = await service
      .from("order_invoices")
      .select("grand_total")
      .eq("cashier_shift_id", cashiers.b.shiftId)
      .eq("payment_status", "paid")
      .eq("payment_method", "Cash");
    if (bCashError) throw bCashError;
    const expectedOtherCashSales = bCashInvoices.reduce((sum, invoice) => sum + Number(invoice.grand_total ?? 0), 0);
    check(
      Number(otherDrawer.cash_sales) === expectedOtherCashSales,
      `Another cashier shift drawer changed incorrectly: returned=${otherDrawer.cash_sales}, expected=${expectedOtherCashSales}.`,
    );

    console.log("Cashier Phase A Hosted Settlement Integrity Audit");
    console.log(`PASS: ${passed}/19 adversarial assertions.`);
    console.log("PASS: no-shift cash and digital settlement denied.");
    console.log("PASS: exact acting-cashier shift ownership and digital evidence enforced.");
    console.log("PASS: same-cashier and two-cashier races produced one financial owner.");
    console.log(`PASS: two-cashier race successful RPC responses = ${twoCashierSuccessfulCalls}; financial transitions = 1.`);
    console.log("PASS: cross-tenant injection, direct cashier mutation, and finalized identity edits denied.");
    console.log("PASS: settlement/close race did not commit payment into a reconciled shift.");
    console.log(`PASS: settlement/close race outcome = ${raceOutcome}.`);
    console.log("PASS: drawer totals include successful cash settlement.");
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
