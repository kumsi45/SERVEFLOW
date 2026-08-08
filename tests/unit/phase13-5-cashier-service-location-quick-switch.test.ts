import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  formatServiceLocationName,
  resolveServiceLocationPanelTitle,
  ServiceLocationQuickSwitch,
  serviceLocationStatusLabel,
  type ServiceLocationCardModel,
} from "../../src/modules/cashier/components/ServiceLocationQuickSwitch";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/modules/cashier/pages/CashierDashboardPage.tsx");
const component = read("src/modules/cashier/components/ServiceLocationQuickSwitch.tsx");
const styles = read("src/modules/cashier/styles/cashierDashboard.css");

const location = (
  key: string,
  status: ServiceLocationCardModel["status"] = "available",
): ServiceLocationCardModel => ({
  id: `internal-db-id-${key}`,
  key,
  tableNumber: Number(key),
  name: `Table ${key}`,
  status,
  supportingText: status === "payment-due" ? "ETB 1,250" : null,
});

describe("Phase 13.5 cashier service-location quick switch", () => {
  it("uses the generic fallback title and honors an existing configured label", () => {
    expect(resolveServiceLocationPanelTitle()).toBe("Service Locations");
    expect(resolveServiceLocationPanelTitle("Rooms")).toBe("Rooms");
  });

  it("uses configured location names without exposing internal IDs or inventing abbreviations", () => {
    expect(formatServiceLocationName({ label: "Room 204", tableNumber: 9 })).toBe("Room 204");
    expect(formatServiceLocationName({ label: "T5", tableNumber: 5 })).toBe("T5");
    expect(formatServiceLocationName({ label: "ID 91", tableNumber: 5 })).toBe("Service Location 5");
    expect(formatServiceLocationName({ label: "", tableNumber: 12 })).toBe("Service Location 12");
  });

  it("renders readable available, payment, bill, receipt, and selected states", () => {
    const locations: ServiceLocationCardModel[] = [
      location("1", "available"),
      location("2", "payment-due"),
      location("3", "bill-requested"),
      location("4", "receipt-pending"),
      location("5", "occupied"),
    ];
    const markup = renderToStaticMarkup(createElement(ServiceLocationQuickSwitch, {
      locations,
      selectedKey: "2",
      loading: false,
      onSelect: vi.fn(),
    }));

    for (const label of ["Available", "Payment due", "Bill requested", "Receipt pending", "Occupied"]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain('class="cd-location-tile payment-due selected"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain("ETB 1,250");
    expect(markup).not.toContain("internal-db-id");
  });

  it("renders thirty locations in one internally scrollable, overflow-safe grid", () => {
    const markup = renderToStaticMarkup(createElement(ServiceLocationQuickSwitch, {
      locations: Array.from({ length: 30 }, (_, index) => location(String(index + 1))),
      selectedKey: "",
      loading: false,
      onSelect: vi.fn(),
    }));
    expect(markup.match(/role="option"/g)).toHaveLength(30);
    expect(styles).toContain("overflow-x: hidden");
    expect(styles).toContain("overflow-y: auto");
    expect(styles).toContain("grid-template-columns: repeat(6, minmax(0, 1fr))");
  });

  it("keeps native selection, arrow-key navigation, and the checkout selection handler", () => {
    expect(component).toContain('type="button"');
    expect(component).toContain('onClick={() => onSelect(location)}');
    expect(component).toContain("handleLocationKeyDown(event, index)");
    expect(component).toContain('"ArrowRight"');
    expect(component).toContain('"ArrowDown"');
    expect(component).toContain("SERVICE_LOCATION_COLUMNS = 6");
    expect(component).toContain('scrollIntoView({ block: "nearest", inline: "nearest" })');
    expect(page).toContain("onSelect={(location) => openTable(location.tableNumber)}");
  });

  it("uses authoritative visual statuses and lightweight loading and empty states", () => {
    expect(serviceLocationStatusLabel("payment-due")).toBe("Payment due");
    expect(serviceLocationStatusLabel("bill-requested")).toBe("Bill requested");
    expect(serviceLocationStatusLabel("receipt-pending")).toBe("Receipt pending");
    expect(component).toContain("No service locations configured");
    expect(component).toContain("Array.from({ length: 6 }");
    expect(page).toContain('billRequestedTableNumbers.has(key)');
    expect(page).toContain('receiptPendingTableNumbers.has(key)');
    expect(page).toContain('awaitingPaymentTableNumbers.has(key)');
  });

  it("removes the heading block so the six-column table grid starts at the top", () => {
    expect(component).not.toContain('className="cd-location-switch-header"');
    expect(component).not.toContain(">Quick Switch<");
    expect(component).not.toContain("locations.length} active");
    expect(component).not.toContain("cd-location-number");
  });
});
