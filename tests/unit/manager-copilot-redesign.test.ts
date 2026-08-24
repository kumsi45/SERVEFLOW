import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  investigateManagerQuestion,
  type ManagerCopilotSnapshot,
} from "../../src/modules/manager/services/managerCopilotService";
import { presentManagerLiveUpdate } from "../../src/modules/manager/managerLiveUpdates";
import type { RestaurantEvent } from "../../src/core/realtime/restaurantEventService";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");
const layout = read("src/modules/manager/components/ManagerLayout.tsx");
const route = read("src/modules/staff-auth/pages/ProtectedManagerRoute.tsx");
const component = read("src/modules/manager/components/ManagerCopilot.tsx");
const styles = read("src/modules/manager/styles/managerCopilot.css");
const chrome = read("src/modules/manager/components/ManagerWorkspaceChrome.tsx");
const chromeStyles = read("src/modules/manager/styles/managerWorkspaceChrome.css");

const emptySnapshot: ManagerCopilotSnapshot = {
  intelligence: null,
  staff: null,
  guests: null,
  kitchen: null,
  inventory: null,
  menu: null,
  unavailable: [],
};

describe("global Manager ServeFlow Copilot", () => {
  it("removes AI from sidebar navigation and mounts Copilot globally", () => {
    expect(layout).not.toContain('key: "ai"');
    expect(layout).not.toContain('href: "/manager/ai"');
    expect(layout).toContain("<ManagerCopilot");
    expect(route).not.toContain("<ManagerAiOperationsPage");
  });

  it("keeps the legacy AI route safe without rendering the old KPI dashboard", () => {
    expect(route).not.toContain("ManagerAiOperationsPage = lazy");
    expect(component).toContain('section === "ai" ? "dashboard"');
    expect(component).toContain('useState(section === "ai")');
  });

  it("provides compact context suggestions, session history, evidence labels and navigation only", () => {
    expect(component).toContain("serveflow.manager-copilot:");
    expect(component).not.toContain("Viewing:");
    expect(component).toContain("contextLabels[activeContext]");
    expect(component).toContain("Based on:");
    expect(component).toContain("Recommended action");
    expect(component).not.toContain("logManagerAiDecision");
    expect(component).not.toContain("Confirm Reassignment");
    expect(component).toContain('event.key === "Enter"');
    expect(component).toContain("onSubmit={submit}");
    expect(component).toContain(".finally(() => setLoading(false))");
  });

  it("fails closed for unsupported attendance and profit questions", () => {
    expect(
      investigateManagerQuestion("Who came late today?", emptySnapshot)
        .conclusion,
    ).toContain("not recording trustworthy employee schedules");
    expect(
      investigateManagerQuestion("What is today's profit?", emptySnapshot)
        .conclusion,
    ).toContain("Reliable profit is not available");
    expect(
      investigateManagerQuestion("What sold the most today?", emptySnapshot)
        .conclusion,
    ).toContain("Item-level sales ranking is not available");
    expect(
      investigateManagerQuestion("Today's sales", emptySnapshot).conclusion,
    ).toContain("operational report is unavailable");
    expect(
      investigateManagerQuestion("Kitchen requests", emptySnapshot).conclusion,
    ).toContain("0 kitchen or department inventory requests");
  });

  it("uses a desktop drawer and full-screen mobile sheet with keyboard-safe sizing", () => {
    expect(styles).toContain("--mcp-viewport-height");
    expect(styles).toContain("@media (max-width: 767px)");
    expect(styles).toContain("font-size: 16px");
    expect(styles).toContain("overscroll-behavior: contain");
    expect(styles).toContain(".manager-copilot-open .ml-bottom-nav");
    expect(component).toContain("useModalFocus");
    expect(component).toContain("window.visualViewport");
  });

  it("deduplicates events and keeps actionable state after its banner expires", () => {
    expect(chrome).toContain("seenEventIds.current.has(event.id)");
    expect(chrome).toContain("seenEventIds.current.clear()");
    expect(chrome).toContain("current.some((item) => item.id === update.id)");
    expect(chrome).toContain('banner.kind === "informational" ? 4000 : 7000');
    expect(chrome).toContain("pendingUpdates.length > 0");
    expect(chrome).toContain("filter((item) => item.id !== update.id)");
    expect(chromeStyles).toContain("top: 76px");
  });

  it("maps notifications to business context without exposing record payloads", () => {
    const event: RestaurantEvent = {
      id: "orders:UPDATE:record:time",
      restaurantId: "tenant-a",
      type: "ORDER_UPDATED",
      table: "orders",
      occurredAt: "2026-08-25T10:00:00Z",
      record: { id: "hidden-record", restaurant_id: "tenant-a" },
      previous: {},
      operation: "UPDATE",
    };
    const update = presentManagerLiveUpdate(event);
    expect(update).toMatchObject({
      context: "tables",
      kind: "actionable",
      title: "Live service activity changed",
    });
    expect(JSON.stringify(update)).not.toContain("hidden-record");
    expect(chrome).toContain("context: update.context");
    expect(chrome).toContain("prompt: update.copilotPrompt");
  });
});
