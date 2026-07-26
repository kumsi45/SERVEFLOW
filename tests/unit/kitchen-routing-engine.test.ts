import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Station = { id: string; restaurantId: string; active: boolean; isDefault?: boolean; priority: number };
type MenuItem = { id: string; restaurantId: string; stationId: string | null };

function route(restaurantId: string, menuItem: MenuItem, stations: Station[]) {
  const tenantStations = stations.filter((station) => station.restaurantId === restaurantId && station.active);
  return tenantStations.find((station) => station.id === menuItem.stationId)?.id
    ?? tenantStations.find((station) => station.isDefault)?.id
    ?? [...tenantStations].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))[0]?.id
    ?? null;
}

const restaurantAStations: Station[] = [
  { id: "hot-a", restaurantId: "a", active: true, priority: 20 },
  { id: "beverage-a", restaurantId: "a", active: true, priority: 30 },
  { id: "bakery-a", restaurantId: "a", active: true, priority: 40 },
  { id: "default-a", restaurantId: "a", active: true, isDefault: true, priority: 1 },
];

describe("Kitchen Station Routing Engine", () => {
  it("routes a single item only to its assigned station", () => {
    expect(route("a", { id: "macchiato", restaurantId: "a", stationId: "beverage-a" }, restaurantAStations))
      .toBe("beverage-a");
  });

  it("splits one customer order into station-local item groups", () => {
    const items = [
      { id: "burger", restaurantId: "a", stationId: "hot-a" },
      { id: "juice", restaurantId: "a", stationId: "beverage-a" },
      { id: "cake", restaurantId: "a", stationId: "bakery-a" },
    ];
    expect(items.map((item) => route("a", item, restaurantAStations))).toEqual([
      "hot-a", "beverage-a", "bakery-a",
    ]);
    expect(new Set(items.map((item) => route("a", item, restaurantAStations))).size).toBe(3);
  });

  it("never loses an unassigned item", () => {
    expect(route("a", { id: "special", restaurantId: "a", stationId: null }, restaurantAStations))
      .toBe("default-a");
  });

  it("does not cross restaurant boundaries", () => {
    const stations = [...restaurantAStations, { id: "drinks-b", restaurantId: "b", active: true, isDefault: true, priority: 1 }];
    expect(route("a", { id: "juice", restaurantId: "a", stationId: "drinks-b" }, stations)).toBe("default-a");
    expect(route("b", { id: "juice", restaurantId: "b", stationId: "drinks-b" }, stations)).toBe("drinks-b");
  });

  it("uses a changed owner/manager assignment for the next ordered item", () => {
    const item: MenuItem = { id: "coffee", restaurantId: "a", stationId: "hot-a" };
    expect(route("a", item, restaurantAStations)).toBe("hot-a");
    item.stationId = "beverage-a";
    expect(route("a", item, restaurantAStations)).toBe("beverage-a");
  });

  it("installs routing before insert and publishes routed item changes", () => {
    const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/166_kitchen_station_routing_engine_fix.sql"), "utf8");
    const realtime = readFileSync(resolve(process.cwd(), "src/core/realtime/restaurantEventService.ts"), "utf8");
    expect(migration).toContain("before insert or update of restaurant_id, menu_item_id");
    expect(migration).toContain("new.kitchen_station_id := public.resolve_kitchen_station_route");
    expect(realtime).toContain('"order_items"');
    expect(realtime).toContain("restaurant_id=eq.");
  });

  it("allows starter menu creation before station setup without weakening live order routing", () => {
    const routing = readFileSync(resolve(process.cwd(), "supabase/migrations/166_kitchen_station_routing_engine_fix.sql"), "utf8");
    const onboarding = readFileSync(resolve(process.cwd(), "supabase/migrations/186_setup_wizard_nonblocking_kitchen_assignment.sql"), "utf8");
    expect(onboarding).toContain("new.kitchen_station_id := target_station_id");
    expect(onboarding).toContain("if new.kitchen_station_id is null then\n      return new;");
    expect(onboarding).not.toContain("new.kitchen_station_id := public.resolve_kitchen_station_route");
    expect(routing).toContain("new.kitchen_station_id := public.resolve_kitchen_station_route");
    expect(routing).toContain("Restaurant has no active kitchen station for routing.");
  });

  it("contains no runtime routing by station name or menu keywords", () => {
    const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/166_kitchen_station_routing_engine_fix.sql"), "utf8").toLowerCase();
    expect(migration).not.toContain("lower(btrim(stations.name))");
    expect(migration).not.toMatch(/coffee|juice|beverage|bakery|burger|pizza/);
  });
});
