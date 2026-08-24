import type { RestaurantEvent } from "../../core/realtime/restaurantEventService";
import type { CopilotContext } from "./services/managerCopilotService";

export type ManagerLiveUpdate = {
  id: string;
  kind: "informational" | "actionable";
  title: string;
  context: CopilotContext;
  copilotPrompt: string;
};

export type OpenManagerCopilotDetail = {
  context?: CopilotContext;
  prompt?: string;
  updateId?: string;
};

export function presentManagerLiveUpdate(
  event: RestaurantEvent,
): ManagerLiveUpdate | null {
  const shared = { id: event.id };
  switch (event.table) {
    case "orders":
    case "order_items":
      return {
        ...shared,
        kind: "actionable",
        title: "Live service activity changed",
        context: "tables",
        copilotPrompt:
          "Explain the latest live service change and what needs attention.",
      };
    case "manager_customer_complaints":
      return {
        ...shared,
        kind: "actionable",
        title: "A guest issue changed",
        context: "customers",
        copilotPrompt:
          "Explain the latest guest issue change and what needs attention.",
      };
    case "restaurant_staff":
      return {
        ...shared,
        kind: "actionable",
        title: "Staff activity changed",
        context: "staff",
        copilotPrompt:
          "Explain the latest staff change and any supported workload impact.",
      };
    case "kitchen_inventory_requests":
      return {
        ...shared,
        kind: "actionable",
        title: "An inventory request changed",
        context: "inventory",
        copilotPrompt:
          "Explain the latest inventory request change and what needs attention.",
      };
    case "order_cancellation_requests":
      return {
        ...shared,
        kind: "actionable",
        title: "A cancellation request changed",
        context: "tables",
        copilotPrompt:
          "Explain the latest cancellation request change and what needs attention.",
      };
    case "menu_items":
      return {
        ...shared,
        kind: "informational",
        title: "Menu availability updated",
        context: "menu",
        copilotPrompt: "Explain the latest menu availability change.",
      };
    case "kitchen_stations":
      return {
        ...shared,
        kind: "informational",
        title: "Kitchen station details updated",
        context: "kitchen",
        copilotPrompt: "Explain the latest kitchen station change.",
      };
    default:
      return null;
  }
}

export function openManagerCopilot(detail?: OpenManagerCopilotDetail) {
  window.dispatchEvent(
    new CustomEvent<OpenManagerCopilotDetail>("serveflow:open-copilot", {
      detail,
    }),
  );
}
