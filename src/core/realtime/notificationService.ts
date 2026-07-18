import type { RestaurantEvent, RestaurantEventType } from "./restaurantEventService";

export type NotificationRole = "cashier" | "kitchen" | "waiter" | "manager" | "owner" | "customer";
type Batch = { events: RestaurantEvent[]; timer?: number };
const batches = new Map<string, Batch>();
const LAST_EVENT_PREFIX = "serveflow.last-notified-event";

const roleEvents: Record<NotificationRole, RestaurantEventType[]> = {
  cashier: ["ORDER_CREATED"], kitchen: ["ORDER_CREATED"], waiter: ["ORDER_READY", "WAITER_CALL"],
  manager: [], owner: [], customer: [],
};
const soundByRole: Partial<Record<NotificationRole, string>> = {
  cashier: "/sounds/new-order.mp3", kitchen: "/sounds/kitchen-ticket.mp3", waiter: "/sounds/ready.mp3",
};

function title(role: NotificationRole, count: number, type: RestaurantEventType) {
  if (role === "cashier") return `${count} New Order${count === 1 ? "" : "s"}`;
  if (role === "kitchen") return `${count} New Kitchen Ticket${count === 1 ? "" : "s"}`;
  if (type === "WAITER_CALL") return `${count} Customer Call${count === 1 ? "" : "s"}`;
  return `${count} Order${count === 1 ? "" : "s"} Ready`;
}

export function notifyRestaurantEvent(role: NotificationRole, event: RestaurantEvent, onToast?: (message: string) => void) {
  if (!roleEvents[role].includes(event.type)) return;
  const storageKey = `${LAST_EVENT_PREFIX}:${role}:${event.restaurantId}`;
  if (localStorage.getItem(storageKey) === event.id) return;
  const key = `${role}:${event.restaurantId}:${event.type}`;
  const batch = batches.get(key) ?? { events: [] };
  batch.events.push(event); window.clearTimeout(batch.timer);
  batch.timer = window.setTimeout(() => {
    const message = title(role, batch.events.length, event.type);
    localStorage.setItem(storageKey, batch.events[batch.events.length - 1]?.id ?? event.id);
    onToast?.(message);
    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
      new Notification(message, { tag: key });
    } else if (soundByRole[role]) {
      const audio = new Audio(soundByRole[role]); audio.play().catch(() => undefined);
    }
    batches.delete(key);
  }, 300);
  batches.set(key, batch);
}
