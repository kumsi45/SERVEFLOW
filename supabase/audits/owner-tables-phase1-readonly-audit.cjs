const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");

function envFile(filePath) {
  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([^#=]+?)\s*=\s*["']?(.*?)["']?\s*$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2]]),
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`PASS ${message}`);
}

async function asJwtRole(db, role, userId, sql, params = []) {
  const savepoint = `role_${crypto.randomUUID().replaceAll("-", "")}`;
  await db.query(`savepoint ${savepoint}`);
  try {
    await db.query(`set local role ${role}`);
    await db.query(
      "select set_config('request.jwt.claim.role', $1, true)",
      [role],
    );
    await db.query(
      "select set_config('request.jwt.claim.sub', $1, true)",
      [userId ?? ""],
    );
    const result = await db.query(sql, params);
    await db.query("reset role");
    await db.query(`release savepoint ${savepoint}`);
    return result;
  } catch (error) {
    await db.query(`rollback to savepoint ${savepoint}`);
    await db.query("reset role");
    await db.query(`release savepoint ${savepoint}`);
    throw error;
  }
}

async function main() {
  const root = path.join(__dirname, "..", "..");
  const connectionString = envFile(
    path.join(root, "supabase", "connection.env"),
  ).SUPABASE_DB_URL;
  if (!connectionString) throw new Error("SUPABASE_DB_URL is required.");

  const migration = fs.readFileSync(
    path.join(
      root,
      "supabase",
      "migrations",
      "260_owner_tables_phase1_correctness_security.sql",
    ),
    "utf8",
  );
  const db = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();

  try {
    await db.query("begin");
    await db.query("set local row_security = on");

    const policies = await db.query(`
      select policyname, roles, qual
      from pg_policies
      where schemaname = 'public' and tablename = 'restaurant_tables'
      order by policyname
    `);
    assert(
      !policies.rows.some((row) => row.policyname === "restaurant_tables_select_public_active"),
      "public-active restaurant table policy is removed",
    );
    assert(
      policies.rows.some((row) => row.policyname === "restaurant_tables_select_staff_same_restaurant"),
      "same-tenant authenticated staff policy is installed",
    );

    await db.query("savepoint anon_capability_check");
    let anonDenied = false;
    try {
      await db.query("set local row_security = on");
      await db.query("set local role anon");
      await db.query(
        "select qr_token, qr_url, qr_path from public.restaurant_tables limit 1",
      );
    } catch (error) {
      anonDenied = /permission denied/i.test(error.message);
    } finally {
      await db.query("rollback to savepoint anon_capability_check");
    }
    assert(anonDenied, "post-fix anon direct capability SELECT is denied");

    const publicMenuTarget = await db.query(`
      select restaurants.slug
      from public.restaurants restaurants
      where restaurants.active
        and exists (
          select 1 from public.restaurant_tables tables
          where tables.restaurant_id = restaurants.id and tables.active
        )
      order by restaurants.created_at
      limit 1
    `);
    assert(publicMenuTarget.rowCount === 1, "hosted data has a public menu audit target");

    await db.query("savepoint public_menu_check");
    await db.query("set local role anon");
    const safeMenu = await db.query(
      "select public.get_public_qr_menu($1) payload",
      [publicMenuTarget.rows[0].slug],
    );
    await db.query("rollback to savepoint public_menu_check");
    const serializedMenu = JSON.stringify(safeMenu.rows[0].payload);
    assert(
      !serializedMenu.includes("qr_token") &&
        !serializedMenu.includes("qr_url") &&
        !serializedMenu.includes("qr_path"),
      "public menu projection contains no equivalent QR capability",
    );
    const publicMenuPayload = safeMenu.rows[0].payload;
    assert(
      typeof publicMenuPayload?.restaurant?.id === "string" &&
        typeof publicMenuPayload?.restaurant?.name === "string" &&
        typeof publicMenuPayload?.restaurant?.slug === "string" &&
        Array.isArray(publicMenuPayload?.categories) &&
        Array.isArray(publicMenuPayload?.items) &&
        Array.isArray(publicMenuPayload?.tables) &&
        publicMenuPayload.tables.every(
          (table) => Number.isInteger(table.table_number) && typeof table.label === "string",
        ),
      "public menu retains branding, menu collections, and non-secret table identity",
    );

    await db.query("savepoint hidden_menu_base_check");
    let hiddenMenuBaseDenied = false;
    try {
      await db.query("set local role anon");
      await db.query(
        "select public.get_public_qr_menu_phase260_base($1)",
        [publicMenuTarget.rows[0].slug],
      );
    } catch (error) {
      hiddenMenuBaseDenied = /permission denied/i.test(error.message);
    } finally {
      await db.query("rollback to savepoint hidden_menu_base_check");
    }
    assert(hiddenMenuBaseDenied, "anon cannot execute the capability-bearing menu base");

    const ownerTarget = await db.query(`
      select staff.user_id, staff.restaurant_id
      from public.restaurant_staff staff
      where staff.active and staff.role = 'owner' and staff.user_id is not null
        and exists (
          select 1 from public.restaurant_tables tables
          where tables.restaurant_id = staff.restaurant_id
        )
      order by staff.created_at
      limit 1
    `);
    assert(ownerTarget.rowCount === 1, "hosted data has an owner access audit target");
    const otherTenant = await db.query(`
      select restaurants.id
      from public.restaurants restaurants
      where restaurants.id <> $1
        and exists (
          select 1 from public.restaurant_tables tables
          where tables.restaurant_id = restaurants.id
        )
      limit 1
    `, [ownerTarget.rows[0].restaurant_id]);

    await db.query("savepoint owner_table_read_check");
    await db.query("set local role authenticated");
    await db.query(
      "select set_config('request.jwt.claim.role', 'authenticated', true)",
    );
    await db.query(
      "select set_config('request.jwt.claim.sub', $1, true)",
      [ownerTarget.rows[0].user_id],
    );
    const ownCapabilities = await db.query(
      "select qr_token from public.restaurant_tables where restaurant_id = $1",
      [ownerTarget.rows[0].restaurant_id],
    );
    const crossTenantCapabilities = otherTenant.rowCount
      ? await db.query(
          "select qr_token from public.restaurant_tables where restaurant_id = $1",
          [otherTenant.rows[0].id],
        )
      : { rowCount: 0 };
    await db.query("rollback to savepoint owner_table_read_check");
    assert(ownCapabilities.rowCount > 0, "owner retains access to own QR table data");
    assert(crossTenantCapabilities.rowCount === 0, "owner cannot read another tenant's QR table data");

    await db.query("savepoint nonstaff_table_read_check");
    await db.query("set local role authenticated");
    await db.query(
      "select set_config('request.jwt.claim.role', 'authenticated', true)",
    );
    await db.query(
      "select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true)",
    );
    const nonstaffCapabilities = await db.query(
      "select qr_token from public.restaurant_tables limit 1",
    );
    await db.query("rollback to savepoint nonstaff_table_read_check");
    assert(nonstaffCapabilities.rowCount === 0, "authenticated non-staff cannot enumerate QR capabilities");

    const definitions = await db.query(`
      select p.proname, p.prosecdef, pg_get_functiondef(p.oid) definition
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = any(array[
          'sync_restaurant_tables_internal',
          'get_owner_table_qr_stats',
          'regenerate_all_restaurant_table_qr',
          'regenerate_restaurant_table_qr',
          'set_restaurant_table_active'
        ])
    `);
    assert(definitions.rowCount === 5, "all five hardened functions exist");
    assert(
      definitions.rows.every((row) => row.prosecdef),
      "all touched authority functions remain SECURITY DEFINER",
    );
    assert(
      definitions.rows.every((row) => /SET search_path TO 'public'/i.test(row.definition)),
      "all touched authority functions pin their search_path",
    );

    const byName = Object.fromEntries(
      definitions.rows.map((row) => [row.proname, row.definition]),
    );
    assert(
      byName.sync_restaurant_tables_internal.includes("sessions.table_id = tables.id") &&
        byName.sync_restaurant_tables_internal.includes("sessions.table_released_at is null"),
      "count reduction uses canonical table identity and unreleased session state",
    );
    const tableForeignKey = await db.query(`
      select pg_get_constraintdef(oid) definition
      from pg_constraint
      where conrelid = 'public.orders'::regclass
        and conname = 'orders_table_same_restaurant'
    `);
    assert(
      tableForeignKey.rowCount === 1 &&
        /ON DELETE SET NULL \(table_id\)/i.test(tableForeignKey.rows[0].definition),
      "table deletion preserves the historical order tenant and clears only table_id",
    );
    assert(
      byName.get_owner_table_qr_stats.includes("orders.table_id = tables.id") &&
        byName.get_owner_table_qr_stats.includes("restaurant_timezone"),
      "owner stats use immutable table identity and restaurant timezone",
    );
    assert(
      !byName.regenerate_restaurant_table_qr.includes("'qr_token',") &&
        !byName.regenerate_all_restaurant_table_qr.includes("'qr_token',") &&
        !byName.set_restaurant_table_active.includes("'qr_token',"),
      "sensitive action audit metadata does not log QR tokens",
    );

    const publicRpcGrants = await db.query(`
      select routine_name, grantee
      from information_schema.routine_privileges
      where specific_schema = 'public'
        and routine_name = any(array[
          'create_public_qr_order',
          'log_public_qr_scan',
          'get_public_qr_canonical_lifecycle'
        ])
        and grantee in ('anon', 'authenticated')
    `);
    assert(
      publicRpcGrants.rows.some((row) => row.grantee === "anon"),
      "guarded public QR RPC execution remains granted",
    );
    const executePrivileges = await db.query(`
      select
        has_function_privilege('anon', 'public.get_public_qr_menu(text)', 'execute') anon_public_menu,
        has_function_privilege('anon', 'public.get_public_qr_menu_phase260_base(text)', 'execute') anon_hidden_menu_base,
        has_function_privilege('anon', 'public.sync_restaurant_tables_internal(uuid)', 'execute') anon_internal_sync,
        has_function_privilege('authenticated', 'public.sync_restaurant_tables_internal(uuid)', 'execute') authenticated_internal_sync,
        has_function_privilege('service_role', 'public.sync_restaurant_tables_internal(uuid)', 'execute') service_internal_sync,
        has_function_privilege('anon', 'public.get_owner_table_qr_stats(uuid)', 'execute') anon_owner_stats,
        has_function_privilege('authenticated', 'public.get_owner_table_qr_stats(uuid)', 'execute') authenticated_owner_stats,
        has_function_privilege('anon', 'public.regenerate_restaurant_table_qr(uuid,uuid)', 'execute') anon_single_regenerate,
        has_function_privilege('authenticated', 'public.regenerate_restaurant_table_qr(uuid,uuid)', 'execute') authenticated_single_regenerate,
        has_function_privilege('anon', 'public.regenerate_all_restaurant_table_qr(uuid)', 'execute') anon_bulk_regenerate,
        has_function_privilege('authenticated', 'public.regenerate_all_restaurant_table_qr(uuid)', 'execute') authenticated_bulk_regenerate,
        has_function_privilege('anon', 'public.set_restaurant_table_active(uuid,uuid,boolean)', 'execute') anon_set_active,
        has_function_privilege('authenticated', 'public.set_restaurant_table_active(uuid,uuid,boolean)', 'execute') authenticated_set_active
    `);
    const privileges = executePrivileges.rows[0];
    assert(
      privileges.anon_public_menu &&
        !privileges.anon_hidden_menu_base &&
        !privileges.anon_internal_sync &&
        !privileges.authenticated_internal_sync &&
        privileges.service_internal_sync &&
        !privileges.anon_owner_stats &&
        privileges.authenticated_owner_stats &&
        !privileges.anon_single_regenerate &&
        privileges.authenticated_single_regenerate &&
        !privileges.anon_bulk_regenerate &&
        privileges.authenticated_bulk_regenerate &&
        !privileges.anon_set_active &&
        privileges.authenticated_set_active,
      "function EXECUTE grants expose only the intended public and authenticated surfaces",
    );

    const fixture = {
      ownerA: crypto.randomUUID(),
      ownerB: crypto.randomUUID(),
      restaurantA: crypto.randomUUID(),
      restaurantB: crypto.randomUUID(),
      staffA: crypto.randomUUID(),
      staffB: crypto.randomUUID(),
      categoryA: crypto.randomUUID(),
      menuItemA: crypto.randomUUID(),
      kitchenStationA: crypto.randomUUID(),
    };
    await db.query(`
      insert into auth.users (
        id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at
      ) values
        ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $3, '', now(), now(), now()),
        ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $4, '', now(), now(), now())
    `, [
      fixture.ownerA,
      fixture.ownerB,
      `owner-tables-phase1-${fixture.ownerA}@example.test`,
      `owner-tables-phase1-${fixture.ownerB}@example.test`,
    ]);
    await db.query(`
      insert into public.restaurants (
        id, name, slug, total_tables, table_count, profile
      ) values
        ($1, 'Owner Tables Phase 1 A', $3, 3, 3, '{"timezone":"Pacific/Kiritimati"}'::jsonb),
        ($2, 'Owner Tables Phase 1 B', $4, 3, 3, '{}'::jsonb)
    `, [
      fixture.restaurantA,
      fixture.restaurantB,
      `owner-tables-phase1-a-${fixture.restaurantA}`,
      `owner-tables-phase1-b-${fixture.restaurantB}`,
    ]);
    await db.query(`
      insert into public.restaurant_staff (
        id, restaurant_id, user_id, role, display_name, email, active
      ) values
        ($1, $3, $5, 'owner', 'Phase 1 Owner A', $7, true),
        ($2, $4, $6, 'owner', 'Phase 1 Owner B', $8, true)
    `, [
      fixture.staffA,
      fixture.staffB,
      fixture.restaurantA,
      fixture.restaurantB,
      fixture.ownerA,
      fixture.ownerB,
      `owner-tables-phase1-${fixture.ownerA}@example.test`,
      `owner-tables-phase1-${fixture.ownerB}@example.test`,
    ]);
    await db.query(`
      insert into public.categories (id, restaurant_id, name)
      values ($1, $2, 'Phase 1 Audit Menu')
    `, [fixture.categoryA, fixture.restaurantA]);
    await db.query(`
      insert into public.kitchen_stations (
        id, restaurant_id, name, active, is_default
      ) values ($1, $2, 'Phase 1 Main Kitchen', true, true)
    `, [fixture.kitchenStationA, fixture.restaurantA]);
    await db.query(`
      insert into public.menu_items (
        id, restaurant_id, category_id, kitchen_station_id, name, price, available
      ) values ($1, $2, $3, $4, 'Phase 1 Audit Item', 1, true)
    `, [
      fixture.menuItemA,
      fixture.restaurantA,
      fixture.categoryA,
      fixture.kitchenStationA,
    ]);

    const tablesA = await db.query(`
      select id, table_number, qr_token
      from public.restaurant_tables
      where restaurant_id = $1
      order by table_number
    `, [fixture.restaurantA]);
    const tablesB = await db.query(`
      select id, table_number, qr_token
      from public.restaurant_tables
      where restaurant_id = $1
      order by table_number
    `, [fixture.restaurantB]);
    assert(tablesA.rowCount === 3 && tablesB.rowCount === 3, "fixture table increases create sequential records");

    let crossTenantManagementDenied = false;
    try {
      await asJwtRole(
        db,
        "authenticated",
        fixture.ownerA,
        "select count(*) from public.sync_restaurant_tables($1, 2)",
        [fixture.restaurantB],
      );
    } catch (error) {
      crossTenantManagementDenied = /Only restaurant owners may configure tables/i.test(error.message);
    }
    assert(crossTenantManagementDenied, "owner cannot manage another tenant's tables");

    await db.query(`
      insert into public.orders (
        id, restaurant_id, status, total_price, customer_name,
        table_id, table_number, payment_method, order_source,
        dining_session_status, operational_status
      ) values ($1, $2, 'cancelled', 0, 'Cross Tenant Session', $3, '3', 'Cash', 'cashier', 'open', 'closed')
    `, [crypto.randomUUID(), fixture.restaurantB, tablesB.rows[2].id]);
    await asJwtRole(
      db,
      "authenticated",
      fixture.ownerA,
      "select count(*) from public.sync_restaurant_tables($1, 2)",
      [fixture.restaurantA],
    );
    assert(
      Number((await db.query("select count(*) count from public.restaurant_tables where restaurant_id=$1", [fixture.restaurantA])).rows[0].count) === 2,
      "cross-tenant open sessions do not block table-count reduction",
    );

    await asJwtRole(
      db,
      "authenticated",
      fixture.ownerA,
      "select count(*) from public.sync_restaurant_tables($1, 3)",
      [fixture.restaurantA],
    );
    const restoredTableA = await db.query(
      "select id from public.restaurant_tables where restaurant_id=$1 and table_number=3",
      [fixture.restaurantA],
    );
    const blockingOrderId = crypto.randomUUID();
    await db.query(`
      insert into public.orders (
        id, restaurant_id, status, total_price, customer_name,
        table_id, table_number, payment_method, order_source,
        dining_session_status, operational_status
      ) values ($1, $2, 'cancelled', 0, 'Legacy Status Mismatch', $3, '3', 'Cash', 'cashier', 'open', 'closed')
    `, [blockingOrderId, fixture.restaurantA, restoredTableA.rows[0].id]);

    let occupiedReductionDenied = false;
    try {
      await asJwtRole(
        db,
        "authenticated",
        fixture.ownerA,
        "select count(*) from public.sync_restaurant_tables($1, 2)",
        [fixture.restaurantA],
      );
    } catch (error) {
      occupiedReductionDenied = /open, unreleased dining session/i.test(error.message);
    }
    assert(occupiedReductionDenied, "legacy status mismatch cannot bypass open-session reduction protection");

    const ownerAuthorizationAfterExpectedFailure = await asJwtRole(
      db,
      "authenticated",
      fixture.ownerA,
      "select auth.uid() actor_id, public.has_staff_role($1, array['owner']::public.restaurant_staff_role[]) authorized",
      [fixture.restaurantA],
    );
    assert(
      ownerAuthorizationAfterExpectedFailure.rows[0].actor_id === fixture.ownerA &&
        ownerAuthorizationAfterExpectedFailure.rows[0].authorized === true,
      "owner authorization survives the expected reduction rejection",
    );

    await db.query(`
      update public.orders
      set dining_session_status='closed', table_released_at=now()
      where id=$1 and restaurant_id=$2
    `, [blockingOrderId, fixture.restaurantA]);
    const ownerAuthorizationAfterRelease = await asJwtRole(
      db,
      "authenticated",
      fixture.ownerA,
      "select auth.uid() actor_id, public.has_staff_role($1, array['owner']::public.restaurant_staff_role[]) authorized",
      [fixture.restaurantA],
    );
    assert(
      ownerAuthorizationAfterRelease.rows[0].actor_id === fixture.ownerA &&
        ownerAuthorizationAfterRelease.rows[0].authorized === true,
      "owner authorization remains valid after releasing the fixture session",
    );
    await asJwtRole(
      db,
      "authenticated",
      fixture.ownerA,
      "select count(*) from public.sync_restaurant_tables($1, 2)",
      [fixture.restaurantA],
    );
    assert(
      Number((await db.query("select count(*) count from public.restaurant_tables where restaurant_id=$1", [fixture.restaurantA])).rows[0].count) === 2,
      "released historical sessions permit table-count reduction",
    );
    const preservedHistoricalOrder = await db.query(
      "select restaurant_id, table_id from public.orders where id=$1",
      [blockingOrderId],
    );
    assert(
      preservedHistoricalOrder.rows[0].restaurant_id === fixture.restaurantA &&
        preservedHistoricalOrder.rows[0].table_id === null,
      "count reduction preserves historical order tenant identity while detaching the removed table",
    );

    const statsTable = await db.query(
      "select id, qr_token from public.restaurant_tables where restaurant_id=$1 and table_number=1",
      [fixture.restaurantA],
    );
    const currentOrderId = crypto.randomUUID();
    await db.query(`
      with bounds as (
        select date_trunc('day', timezone('Pacific/Kiritimati', now()))
          at time zone 'Pacific/Kiritimati' today_start
      )
      insert into public.orders (
        id, restaurant_id, status, total_price, customer_name,
        table_id, table_number, payment_method, order_source,
        dining_session_status, operational_status, created_at
      ) values
        ($1, $2, 'pending', 0, 'Current Local Day', $3, '1', 'Cash', 'cashier', 'closed', 'new', (select today_start + interval '1 hour' from bounds)),
        ($4, $2, 'pending', 0, 'Previous Local Day', $3, '1', 'Cash', 'cashier', 'closed', 'new', (select today_start - interval '1 hour' from bounds)),
        ($5, $2, 'pending', 0, 'Legacy Unattributed', null, '1', 'Cash', 'cashier', 'closed', 'new', (select today_start + interval '2 hours' from bounds))
    `, [
      currentOrderId,
      fixture.restaurantA,
      statsTable.rows[0].id,
      crypto.randomUUID(),
      crypto.randomUUID(),
    ]);
    const stats = await asJwtRole(
      db,
      "authenticated",
      fixture.ownerA,
      "select orders_today, last_order_at from public.get_owner_table_qr_stats($1) where table_number=1",
      [fixture.restaurantA],
    );
    assert(Number(stats.rows[0].orders_today) === 1, "Orders Today uses table_id and restaurant-local midnight");
    const lastOrder = await db.query("select created_at from public.orders where id=$1", [currentOrderId]);
    assert(
      new Date(stats.rows[0].last_order_at).getTime() === new Date(lastOrder.rows[0].created_at).getTime(),
      "Last Order ignores legacy null-table attribution",
    );

    const validScan = await asJwtRole(
      db,
      "anon",
      null,
      "select public.log_public_qr_scan($1, '1', $2::text)",
      [`owner-tables-phase1-a-${fixture.restaurantA}`, statsTable.rows[0].qr_token],
    );
    assert(validScan.rowCount === 1, "legitimate printed QR still validates through the guarded scan path");
    const validLifecycle = await asJwtRole(
      db,
      "anon",
      null,
      "select public.get_public_qr_canonical_lifecycle($1, '1', $2::text, $3) payload",
      [
        `owner-tables-phase1-a-${fixture.restaurantA}`,
        statsTable.rows[0].qr_token,
        currentOrderId,
      ],
    );
    assert(
      validLifecycle.rowCount === 1 && validLifecycle.rows[0].payload !== null,
      "legitimate printed QR still reaches the canonical customer lifecycle lookup",
    );
    const publicOrder = await asJwtRole(
      db,
      "anon",
      null,
      `select public.create_public_qr_order(
        $1, '1', $2::text, $3::text, 'Phase 1 Guest', 'Cash',
        jsonb_build_array(jsonb_build_object('menu_item_id', $4::uuid, 'quantity', 1))
      ) payload`,
      [
        `owner-tables-phase1-a-${fixture.restaurantA}`,
        statsTable.rows[0].qr_token,
        crypto.randomUUID(),
        fixture.menuItemA,
      ],
    );
    assert(
      typeof publicOrder.rows[0]?.payload?.order_id === "string",
      "legitimate printed QR still creates an order through the canonical customer RPC",
    );
    for (const [label, token] of [
      ["wrong token", crypto.randomUUID()],
      ["missing token", ""],
      ["cross-tenant token", tablesB.rows[0].qr_token],
    ]) {
      let rejected = false;
      try {
        await asJwtRole(
          db,
          "anon",
          null,
          "select public.log_public_qr_scan($1, '1', $2::text)",
          [`owner-tables-phase1-a-${fixture.restaurantA}`, token],
        );
      } catch (error) {
        rejected = /valid table QR|Invalid or expired table QR/i.test(error.message);
      }
      assert(rejected, `${label} is rejected`);
    }
    const regenerated = await asJwtRole(
      db,
      "authenticated",
      fixture.ownerA,
      "select * from public.regenerate_restaurant_table_qr($1, $2)",
      [fixture.restaurantA, statsTable.rows[0].id],
    );
    const regeneratedEvent = await db.query(`
      select restaurant_id, performed_by_staff_id, details
      from public.staff_activity_log
      where restaurant_id=$1 and action='restaurant_table_qr_regenerated'
      order by created_at desc
      limit 1
    `, [fixture.restaurantA]);
    assert(
      regeneratedEvent.rowCount === 1 &&
        regeneratedEvent.rows[0].restaurant_id === fixture.restaurantA &&
        regeneratedEvent.rows[0].performed_by_staff_id === fixture.staffA &&
        regeneratedEvent.rows[0].details.table_id === statsTable.rows[0].id &&
        regeneratedEvent.rows[0].details.table_number === 1 &&
        !/qr_token|qr_path|qr_url|https?:/i.test(JSON.stringify(regeneratedEvent.rows[0].details)),
      "single QR regeneration writes a correctly attributed secret-free audit event",
    );
    const rotatedToken = regenerated.rows[0].qr_token;
    let rotatedOldTokenRejected = false;
    try {
      await asJwtRole(
        db,
        "anon",
        null,
        "select public.log_public_qr_scan($1, '1', $2::text)",
        [`owner-tables-phase1-a-${fixture.restaurantA}`, statsTable.rows[0].qr_token],
      );
    } catch (error) {
      rotatedOldTokenRejected = /Invalid or expired table QR/i.test(error.message);
    }
    assert(rotatedOldTokenRejected, "rotating the stored capability immediately invalidates the previous QR token");
    const rotatedCurrentToken = await asJwtRole(
      db,
      "anon",
      null,
      "select public.log_public_qr_scan($1, '1', $2::text)",
      [`owner-tables-phase1-a-${fixture.restaurantA}`, rotatedToken],
    );
    assert(rotatedCurrentToken.rowCount === 1, "the current rotated QR token remains valid");
    const disabled = await asJwtRole(
      db,
      "authenticated",
      fixture.ownerA,
      "select * from public.set_restaurant_table_active($1, $2, false)",
      [fixture.restaurantA, statsTable.rows[0].id],
    );
    const disabledEvent = await db.query(`
      select restaurant_id, performed_by_staff_id, details
      from public.staff_activity_log
      where restaurant_id=$1 and action='restaurant_table_disabled'
      order by created_at desc
      limit 1
    `, [fixture.restaurantA]);
    assert(
      disabled.rows[0].active === false &&
        disabledEvent.rowCount === 1 &&
        disabledEvent.rows[0].restaurant_id === fixture.restaurantA &&
        disabledEvent.rows[0].performed_by_staff_id === fixture.staffA &&
        disabledEvent.rows[0].details.table_id === statsTable.rows[0].id &&
        disabledEvent.rows[0].details.previous_active === true &&
        disabledEvent.rows[0].details.new_active === false &&
        !/qr_token|qr_path|qr_url|https?:/i.test(JSON.stringify(disabledEvent.rows[0].details)),
      "table disable writes a correctly attributed secret-free state-transition audit event",
    );
    let inactiveRejected = false;
    try {
      await asJwtRole(
        db,
        "anon",
        null,
        "select public.log_public_qr_scan($1, '1', $2::text)",
        [`owner-tables-phase1-a-${fixture.restaurantA}`, rotatedToken],
      );
    } catch (error) {
      inactiveRejected = /Invalid or expired table QR/i.test(error.message);
    }
    assert(inactiveRejected, "inactive table QR is rejected by the guarded public path");
    let inactiveOrderRejected = false;
    try {
      await asJwtRole(
        db,
        "anon",
        null,
        "select public.create_public_qr_order($1, '1', $2::text, $3::text, 'Disabled Table Guest', 'Cash', jsonb_build_array(jsonb_build_object('menu_item_id', $4::uuid, 'quantity', 1)))",
        [`owner-tables-phase1-a-${fixture.restaurantA}`, rotatedToken, crypto.randomUUID(), fixture.menuItemA],
      );
    } catch (error) {
      inactiveOrderRejected = /Invalid or expired table QR/i.test(error.message);
    }
    assert(inactiveOrderRejected, "inactive table rejects new public QR ordering");
    const enabled = await asJwtRole(
      db,
      "authenticated",
      fixture.ownerA,
      "select * from public.set_restaurant_table_active($1, $2, true)",
      [fixture.restaurantA, statsTable.rows[0].id],
    );
    const enabledEvent = await db.query(`
      select restaurant_id, performed_by_staff_id, details
      from public.staff_activity_log
      where restaurant_id=$1 and action='restaurant_table_enabled'
      order by created_at desc
      limit 1
    `, [fixture.restaurantA]);
    assert(
      enabled.rows[0].active === true &&
        enabled.rows[0].qr_token === rotatedToken &&
        enabledEvent.rowCount === 1 &&
        enabledEvent.rows[0].restaurant_id === fixture.restaurantA &&
        enabledEvent.rows[0].performed_by_staff_id === fixture.staffA &&
        enabledEvent.rows[0].details.table_id === statsTable.rows[0].id &&
        enabledEvent.rows[0].details.previous_active === false &&
        enabledEvent.rows[0].details.new_active === true &&
        !/qr_token|qr_path|qr_url|https?:/i.test(JSON.stringify(enabledEvent.rows[0].details)),
      "table enable writes a secret-free audit event and preserves the QR token",
    );

    await db.query("rollback");
    const rolledBackState = await db.query(`
      select
        exists (
          select 1 from pg_policies
          where schemaname='public' and tablename='restaurant_tables'
            and policyname='restaurant_tables_select_public_active'
        not exists (
          select 1 from pg_policies
          where schemaname='public' and tablename='restaurant_tables'
            and policyname='restaurant_tables_select_public_active'
        ) public_policy_remains_absent,
        to_regprocedure('public.get_public_qr_menu_phase260_base(text)') is not null hidden_base_remains,
        not exists (
          select 1 from public.restaurants where id in ($1, $2)
        ) fixtures_absent
    `, [fixture.restaurantA, fixture.restaurantB]);
    assert(
      rolledBackState.rows[0].public_policy_remains_absent &&
        rolledBackState.rows[0].hidden_base_remains &&
        rolledBackState.rows[0].fixtures_absent,
      "deployed migration remains effective and all hosted verification fixtures are absent after rollback",
    );
    console.log("ROLLBACK Hosted schema left unchanged.");
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(`FAIL ${error.message}${error.where ? `\n${error.where}` : ""}`);
  process.exit(1);
});
