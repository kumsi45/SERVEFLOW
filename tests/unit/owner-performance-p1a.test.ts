import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  INITIAL_OWNER_CORE_STATUS,
  OWNER_CORE_RESOURCES,
  hasAuthoritativeOwnerConfig,
  isOwnerWorkspaceAvailable,
  isOwnerWorkspaceLoading,
  startOwnerCoreLoads,
  type OwnerCoreResource,
  type OwnerCoreResourceStatus,
  type OwnerCoreWorkspace,
} from "../../src/modules/owner/services/ownerPerformance";

const ownerPage = readFileSync(
  "src/modules/owner/pages/OwnerDashboardPage.tsx",
  "utf8",
);

function status(
  overrides: Partial<Record<OwnerCoreResource, OwnerCoreResourceStatus>>,
) {
  return { ...INITIAL_OWNER_CORE_STATUS, ...overrides };
}

describe("Owner performance P1A", () => {
  it("starts every shared core loader once without starting Reports work", async () => {
    const calls = Object.fromEntries(
      OWNER_CORE_RESOURCES.map((resource) => [resource, vi.fn(async () => undefined)]),
    ) as Record<OwnerCoreResource, ReturnType<typeof vi.fn>>;
    const failures = vi.fn();

    await Promise.all(startOwnerCoreLoads(calls, failures));

    for (const resource of OWNER_CORE_RESOURCES) {
      expect(calls[resource]).toHaveBeenCalledTimes(1);
    }
    expect(OWNER_CORE_RESOURCES).not.toContain("reports");
    expect(failures).not.toHaveBeenCalled();
  });

  it("keeps direct core entries free of the removed dashboard report loader", () => {
    const directEntries: OwnerCoreWorkspace[] = [
      "overview",
      "orders",
      "qr",
      "analytics",
      "menu",
    ];
    for (const workspace of directEntries) {
      expect(isOwnerWorkspaceLoading(workspace, INITIAL_OWNER_CORE_STATUS)).toBe(
        workspace !== "analytics",
      );
      expect(OWNER_CORE_RESOURCES).not.toContain("reports");
    }
    expect(ownerPage).not.toContain("function loadDashboardReports");
    expect(ownerPage).not.toContain("setDashboardReports");
  });

  it("lets Orders render when its snapshot is ready despite unrelated slow work", () => {
    const resources = status({ orders: "ready" });
    expect(isOwnerWorkspaceLoading("orders", resources)).toBe(false);
    expect(isOwnerWorkspaceAvailable("orders", resources)).toBe(true);
    expect(isOwnerWorkspaceLoading("overview", resources)).toBe(true);
  });

  it("lets Home render after only its authoritative resources settle", () => {
    const resources = status({
      orders: "ready",
      staff: "ready",
      tables: "ready",
      menu: "loading",
      categories: "error",
      payments: "loading",
      stations: "loading",
    });
    expect(isOwnerWorkspaceLoading("overview", resources)).toBe(false);
    expect(isOwnerWorkspaceAvailable("overview", resources)).toBe(true);
  });

  it("does not turn a failed required resource into a false ready state", () => {
    const resources = status({
      orders: "ready",
      staff: "error",
      tables: "ready",
    });
    expect(isOwnerWorkspaceLoading("overview", resources)).toBe(false);
    expect(isOwnerWorkspaceAvailable("overview", resources)).toBe(false);
  });

  it("tracks Tables and Menu readiness independently", () => {
    const resources = status({
      tables: "ready",
      tableSessions: "ready",
      menu: "ready",
      categories: "ready",
      stations: "loading",
    });
    expect(isOwnerWorkspaceLoading("qr", resources)).toBe(false);
    expect(isOwnerWorkspaceAvailable("qr", resources)).toBe(true);
    expect(isOwnerWorkspaceLoading("menu", resources)).toBe(true);
  });

  it("waits for the authoritative tenant config before Home comparison", () => {
    expect(hasAuthoritativeOwnerConfig(null, "restaurant-a")).toBe(false);
    expect(hasAuthoritativeOwnerConfig("restaurant-b", "restaurant-a")).toBe(false);
    expect(hasAuthoritativeOwnerConfig("restaurant-a", "restaurant-a")).toBe(true);
    expect(ownerPage).toContain(
      "hasAuthoritativeOwnerConfig(restaurantConfig?.id, restaurantId)",
    );
  });

  it("reuses the Orders snapshot obligation result instead of mounting a duplicate read", async () => {
    const obligationRead = vi.fn(async () => undefined);
    const loaders = Object.fromEntries(
      OWNER_CORE_RESOURCES.map((resource) => [
        resource,
        resource === "orders" ? obligationRead : vi.fn(async () => undefined),
      ]),
    ) as Record<OwnerCoreResource, () => Promise<void>>;

    await Promise.all(startOwnerCoreLoads(loaders, vi.fn()));

    expect(obligationRead).toHaveBeenCalledTimes(1);
    expect(OWNER_CORE_RESOURCES).not.toContain("obligations");
    expect(ownerPage).toContain(
      "setUnresolvedObligations(snapshot.unresolvedObligations)",
    );
    expect(ownerPage).not.toContain("async function loadUnresolvedObligations()");
  });

  it("keeps the real Reports workspace loader available", () => {
    expect(ownerPage).toContain("function ReportsPage");
    expect(ownerPage).toContain("loadOwnerReportData(");
    expect(ownerPage).toContain("loadOwnerDiningBillReportData(");
  });
});
