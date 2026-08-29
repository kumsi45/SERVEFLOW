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
const errorBoundary = read("src/modules/manager/components/ManagerCopilotErrorBoundary.tsx");
const styles = read("src/modules/manager/styles/managerCopilot.css");
const chrome = read("src/modules/manager/components/ManagerWorkspaceChrome.tsx");
const chromeStyles = read("src/modules/manager/styles/managerWorkspaceChrome.css");
const liveUpdates = read("src/modules/manager/managerLiveUpdates.ts");
const viteConfig = read("vite.config.ts");

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
    expect(component).toContain("const sendQuestion = useCallback");
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
    expect(styles).toContain("height: 100dvh");
    expect(styles).toContain("z-index: 1000");
    expect(styles).toContain("isolation: isolate");
    expect(styles).toContain("@media (max-width: 767px)");
    expect(styles).toContain("font-size: 16px");
    expect(styles).toContain("overscroll-behavior: contain");
    expect(styles).toContain(".manager-copilot-open .ml-bottom-nav");
    expect(component).toContain("useModalFocus");
    expect(component).toContain("createPortal");
    expect(component).not.toContain("window.visualViewport");
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
    expect(chrome).toContain("openManagerCopilotForUpdate(update)");
    expect(liveUpdates).toContain("context: update.context");
    expect(liveUpdates).toContain("title: update.title");
    expect(liveUpdates).toContain("prompt: update.copilotPrompt");
  });

  it("uses one optimistic send pipeline without coupling Send to snapshot refresh", () => {
    expect(component).toContain('role: "manager"');
    expect(component).toContain("text: question");
    expect(component).toContain("snapshotRef.current ?? (await loadSnapshot())");
    expect(component).toContain("void sendQuestion(question.text, question.context)");
    expect(component).toContain("void sendQuestion(draft, activeContext)");
    expect(component).toContain("disabled={!draft.trim() || submitting}");
    expect(component).not.toContain("disabled={!draft.trim() || snapshotLoading}");
    expect(component).toContain("Couldn't load this answer. Try again.");
    expect(component).toContain("createBrowserUuid()");
    expect(component).not.toContain("crypto.randomUUID()");
    expect(component).toContain("normalizeCopilotAnswer");
    expect(component).toContain("normalizeStoredMessage");
  });

  it("guards every open conversation against a blank render state", () => {
    expect(component).toContain("mcp-update-context");
    expect(component).toContain("hasVisibleConversationState");
    expect(component).toContain("mcp-render-guard");
    expect(component).toContain("Loading current operations...");
    expect(component).toContain("Thinking...");
    expect(styles).toContain("pointer-events: auto");
  });

  it("keeps snapshot and conversation storage tenant scoped", () => {
    expect(component).toContain("snapshotLoader(restaurantId)");
    expect(component).toContain("storageKey(restaurantId)");
    expect(component).not.toContain("record.restaurant_id");
  });

  it("removes Manager-facing diagnostics and keeps a business-only fallback", () => {
    for (const internalText of [
      "Debug",
      "Copilot diagnostic",
      "Build timestamp",
      "Snapshot requested",
      "Textarea pointerdown",
      "Send tapped",
      "Investigator started",
      "Answer committed to state",
    ]) {
      expect(component).not.toContain(internalText);
    }
    expect(styles).not.toContain("mcp-diagnostic");
    expect(chrome).not.toContain("CopilotDiagnostic");
    expect(chrome).not.toContain("Realtime update received");
    expect(errorBoundary).toContain("getDerivedStateFromError");
    expect(errorBoundary).toContain("componentDidCatch");
    expect(errorBoundary).toContain("Copilot encountered a display error.");
    expect(errorBoundary).toContain("import.meta.env.DEV");
    expect(errorBoundary).not.toContain("Crash stage");
    expect(errorBoundary).not.toContain("Error type");
    expect(errorBoundary).not.toContain("Safe error message");
    expect(errorBoundary).not.toContain("access_token");
    expect(viteConfig).not.toContain("__SERVEFLOW_BUILD_ID__");
  });
});
