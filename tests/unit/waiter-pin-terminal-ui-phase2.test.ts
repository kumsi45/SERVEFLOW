import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const page = read("src/modules/waiter-auth/pages/WaiterLoginPage.tsx");
const components = read("src/modules/waiter-auth/components/WaiterLoginTerminal.tsx");
const service = read("src/modules/waiter-auth/services/waiterAuthService.ts");
const styles = read("src/modules/waiter-auth/styles/waiterLogin.css");
const tableStatusMigration = read("supabase/migrations/256_waiter_terminal_table_status_context.sql");

describe("Phase 2 waiter PIN-first tablet terminal UI", () => {
  it("keeps the direct secure PIN architecture unchanged", () => {
    expect(page).toContain("loadWaiterTerminalContext");
    expect(page).toContain("signInWaiterWithPin");
    expect(page).toContain("submitPin(nextPin)");
    expect(page).not.toContain("Waiter Login");
    expect(page).not.toContain("get_restaurant_terminal_staff");
    expect(page).not.toContain("get_waiter_dashboard_tables");
  });

  it("uses only safe terminal identity and generic pre-auth guidance", () => {
    expect(page).toContain("restaurant.logoUrl");
    expect(page).toContain("restaurant.name");
    expect(page).toContain("Ready for service");
    expect(page).toContain("Waiter terminal");
    expect(page).not.toContain("Staff terminal");
    expect(page).toContain("Secure staff access");
    expect(page).not.toMatch(/customer name|guest information|sales value|staff performance|ready-order|manager alert/i);
  });

  it("adds only aggregate pre-auth table status from the terminal context", () => {
    expect(page).toContain("TableStatusStrip");
    expect(page).toContain("restaurant.tableStatus");
    expect(service).toContain("total_tables");
    expect(service).toContain("available_tables");
    expect(service).toContain("occupied_tables");
    expect(tableStatusMigration).toContain("security definer");
    expect(tableStatusMigration).toContain("grant execute on function public.get_waiter_terminal_context(text)");
    expect(tableStatusMigration).toContain("to anon, authenticated");
    expect(tableStatusMigration).toContain("count(active_tables.id)::integer as total_tables");
    expect(tableStatusMigration).toContain("count(occupied_tables.id)::integer as occupied_tables");
    expect(tableStatusMigration).toContain("orders.dining_session_status = 'open'");
    expect(tableStatusMigration).toContain("orders.table_released_at is null");
    expect(tableStatusMigration).not.toContain("grant select on public.restaurant_tables to anon");
    expect(tableStatusMigration).not.toContain("customer_name");
    expect(tableStatusMigration).not.toContain("total_price");
    expect(tableStatusMigration).not.toContain("assigned_waiter");
  });

  it("safely recreates the RPC when its OUT-column contract changes", () => {
    const dropIndex = tableStatusMigration.indexOf(
      "drop function if exists public.get_waiter_terminal_context(text);"
    );
    const createIndex = tableStatusMigration.indexOf(
      "create function public.get_waiter_terminal_context("
    );

    expect(dropIndex).toBeGreaterThanOrEqual(0);
    expect(createIndex).toBeGreaterThan(dropIndex);
    expect(tableStatusMigration).not.toContain(
      "create or replace function public.get_waiter_terminal_context("
    );
    expect(tableStatusMigration).not.toMatch(/drop function[^;]*\bcascade\b/i);
    expect(tableStatusMigration).toContain("total_tables integer");
    expect(tableStatusMigration).toContain("available_tables integer");
    expect(tableStatusMigration).toContain("occupied_tables integer");
    expect(tableStatusMigration).toContain("other_tables integer");
    expect(tableStatusMigration).not.toContain(
      "restaurants.id::text = normalized_input.raw_value"
    );
    expect(tableStatusMigration).toContain(
      "to service_role;"
    );
  });

  it("provides stable verification, rate-limit, clock, and accessible input states", () => {
    expect(page).toContain("Verifying…");
    expect(page).toContain("Too many attempts. Try again shortly or contact a manager.");
    expect(components).toContain('aria-label="Numeric PIN pad"');
    expect(components).toContain('aria-label="Delete last digit"');
    expect(components).toContain("Local time");
    expect(styles).toContain(".wlt-pin-feedback");
    expect(styles).toContain("min-height: 38px");
  });

  it("defines tablet composition, mobile simplification, touch size, and reduced motion", () => {
    expect(styles).toContain("grid-template-columns: minmax(260px, 1fr) minmax(380px, 430px)");
    expect(styles).toContain("@media (max-width: 900px)");
    expect(styles).toContain("@media (max-width: 620px)");
    expect(styles).toContain(".wlt-product-identity > span");
    expect(styles).toContain("min-height: clamp(58px, 7.5vh, 68px)");
    expect(styles).toContain(".wlt-pin-panel > .wlt-table-status");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
