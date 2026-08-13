import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/modules/manager/pages/ManagerKitchenSupervisionPage.tsx");
const service = read("src/modules/manager/services/managerKitchenSupervisionService.ts");
const styles = read("src/modules/manager/styles/managerKitchenSupervision.css");
const inventory = read("src/modules/kitchen/services/inventoryRequestService.ts");
const authority = read("supabase/migrations/115_phase_manager_kitchen_supervision_m4.sql");

describe("Manager Kitchen supervision redesign", () => {
  it("replaces KDS-like navigation with manager supervision views", () => {
    expect(page).toContain('type KitchenView = "overview" | "orders" | "performance"');
    expect(page).toContain('useState<KitchenView>("overview")');
    expect(page).not.toContain('type KitchenTab = "stations"');
    expect(page).not.toContain("Station Dashboard");
    expect(page).not.toContain("No tickets in this tab for this station.");
  });

  it("provides the compact command summary without giant KPI cards", () => {
    for (const metric of ["Waiting", "Preparing", "Delayed", "Ready", "Avg prep", "Active staff", "Stations"]) expect(page).toContain(metric);
    expect(styles).toContain("grid-template-columns: repeat(7, minmax(0, 1fr))");
    expect(styles).not.toContain("min-height: 104px");
  });

  it("uses supported attention rules and does not flag an idle unstaffed station", () => {
    expect(service).toContain("station.queueLength > 0 && station.activeStaff === 0");
    expect(page).toContain("station.queueLength > 0 && station.activeStaff === 0");
    expect(page).toContain("Kitchen operating normally — no manager intervention required.");
    expect(page).not.toContain("station.activeStaff === 0 && station.queueLength === 0");
  });

  it("uses compact station rows and a contextual overlay inspector", () => {
    expect(page).toContain("mks-station-row");
    expect(page).toContain('role="dialog"');
    expect(page).toContain('aria-label="Close station inspector"');
    expect(styles).toContain("position: fixed");
    expect(styles).toContain("width: min(440px, 100%)");
    expect(page).not.toContain('className="mks-layout"');
    expect(page).not.toContain('className="mks-board"');
  });

  it("keeps communication and pause controls contextual and confirms pause", () => {
    expect(page).not.toContain('className="mks-message-form"');
    expect(page).toContain("••• Station Actions");
    expect(page).toContain("Send Message");
    expect(page).toContain("window.confirm");
    expect(page).toContain("prevents manager reassignment to this station until it is resumed");
    expect(page).toContain("setManagerKitchenStationPaused");
    expect(authority).toContain("manager_set_kitchen_station_paused");
  });

  it("integrates tenant-scoped requests as an Inventory handoff", () => {
    expect(page).toContain("loadInventoryRequests(restaurantId)");
    expect(page).toContain('"kitchen_inventory_requests"');
    expect(page).toContain("navigateToInventory(restaurantId)");
    expect(page).not.toContain("processInventoryRequest");
    expect(inventory).toContain('.eq("restaurant_id",restaurantId)');
  });

  it("shows item-aware order supervision and supported filters", () => {
    expect(service).toContain("menu_items!order_items_menu_item_id_fkey(name)");
    expect(service).toContain("items: [{ id: item.id, name: itemName(item), quantity }]");
    expect(page).toContain('type OrderFilter = "all" | "waiting" | "preparing" | "ready" | "delayed"');
    expect(page).toContain("batchItems(batch)");
    expect(page).toContain("Current Orders");
  });

  it("retains tenant realtime and manager-authorized handlers", () => {
    expect(page).toContain("useTenantRealtime");
    expect(page).toContain("restaurantId,");
    for (const handler of ["prioritizeManagerKitchenOrder", "reassignManagerKitchenBatch", "sendManagerKitchenMessage", "callAdditionalKitchenStaff"]) expect(page).toContain(handler);
    expect(page).not.toContain(".channel(");
  });

  it("reflows for laptop, tablet, mobile, and narrow mobile without page tables", () => {
    expect(styles).toContain("@media (max-width: 1199px)");
    expect(styles).toContain("@media (max-width: 1023px)");
    expect(styles).toContain("@media (max-width: 767px)");
    expect(styles).toContain("@media (max-width: 359px)");
    expect(styles).toContain(".mks-inspector { width: 100%");
  });
});
