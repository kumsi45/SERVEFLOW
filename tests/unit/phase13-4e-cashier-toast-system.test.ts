import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CASHIER_TOAST_DURATIONS,
  CASHIER_TOAST_EXIT_DURATION,
  CASHIER_TOAST_MAX_VISIBLE,
  CashierToastController,
} from "../../src/modules/cashier/cashierToast";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/modules/cashier/pages/CashierDashboardPage.tsx");
const component = read("src/modules/cashier/components/CashierToastSystem.tsx");
const styles = read("src/modules/cashier/styles/cashierDashboard.css");
const toastStyles = styles.slice(styles.indexOf("Phase 13.4E"));

describe("Phase 13.4E cashier toast controller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the approved semantic durations and auto-dismisses success", () => {
    expect(CASHIER_TOAST_DURATIONS).toEqual({
      success: 4_000,
      information: 5_000,
      warning: 7_000,
      error: null,
    });
    const controller = new CashierToastController();
    controller.push({ type: "success", title: "Payment verified" });
    expect(controller.getSnapshot().visible).toHaveLength(1);

    vi.advanceTimersByTime(4_000);
    expect(controller.getSnapshot().visible[0]?.exiting).toBe(true);
    vi.advanceTimersByTime(CASHIER_TOAST_EXIT_DURATION);
    expect(controller.getSnapshot().visible).toHaveLength(0);
  });

  it("pauses and resumes the remaining timer for hover and keyboard focus", () => {
    const controller = new CashierToastController();
    const id = controller.push({ type: "information", title: "New order received" })!;

    vi.advanceTimersByTime(2_000);
    controller.pause(id, "hover");
    controller.pause(id, "focus");
    vi.advanceTimersByTime(10_000);
    expect(controller.getSnapshot().visible[0]?.paused).toBe(true);

    controller.resume(id, "hover");
    vi.advanceTimersByTime(4_000);
    expect(controller.getSnapshot().visible).toHaveLength(1);
    controller.resume(id, "focus");
    vi.advanceTimersByTime(2_999);
    expect(controller.getSnapshot().visible[0]?.exiting).toBe(false);
    vi.advanceTimersByTime(1);
    expect(controller.getSnapshot().visible[0]?.exiting).toBe(true);
  });

  it("shows at most three newest toasts and promotes a queued fourth", () => {
    const controller = new CashierToastController();
    const first = controller.push({ type: "error", title: "First" })!;
    controller.push({ type: "error", title: "Second" });
    controller.push({ type: "error", title: "Third" });
    controller.push({ type: "error", title: "Fourth" });

    expect(CASHIER_TOAST_MAX_VISIBLE).toBe(3);
    expect(controller.getSnapshot().visible.map((toast) => toast.title)).toEqual([
      "Third",
      "Second",
      "First",
    ]);
    expect(controller.getSnapshot().queuedCount).toBe(1);

    controller.dismiss(first);
    vi.advanceTimersByTime(CASHIER_TOAST_EXIT_DURATION);
    expect(controller.getSnapshot().visible.map((toast) => toast.title)).toEqual([
      "Fourth",
      "Third",
      "Second",
    ]);
    expect(controller.getSnapshot().queuedCount).toBe(0);
  });

  it("prevents short-interval duplicates without suppressing separate events", () => {
    const controller = new CashierToastController();
    expect(controller.push({ type: "success", title: "Receipt printed", dedupeKey: "receipt:194:1" })).not.toBeNull();
    expect(controller.push({ type: "success", title: "Receipt printed", dedupeKey: "receipt:194:1" })).toBeNull();
    expect(controller.push({ type: "success", title: "Receipt printed", dedupeKey: "receipt:195:1" })).not.toBeNull();
  });

  it("keeps errors visible until the cashier manually closes them", () => {
    const controller = new CashierToastController();
    const id = controller.push({ type: "error", title: "Receipt printing failed" })!;
    vi.advanceTimersByTime(60_000);
    expect(controller.getSnapshot().visible[0]?.exiting).toBe(false);
    controller.dismiss(id);
    vi.advanceTimersByTime(CASHIER_TOAST_EXIT_DURATION);
    expect(controller.getSnapshot().visible).toHaveLength(0);
  });
});

describe("Phase 13.4E cashier toast presentation", () => {
  it("removes the blocking routine banner and keeps blockers compact", () => {
    expect(page).not.toContain("realtimeNotice");
    expect(page).not.toContain('className="cd-realtime-notice"');
    expect(page).not.toContain(">Dismiss<");
    expect(page).toContain('className="cd-persistent-alerts"');
    expect(page).toContain("Action required");
  });

  it("connects existing cashier results to concise semantic toasts", () => {
    for (const title of [
      "New order received",
      "Payment verified",
      "Payment verification failed",
      "Bill ready for review",
      "Receipt printed",
      "Receipt printing failed",
      "Order completed",
      "Network sync failed",
    ]) {
      expect(page).toContain(title);
    }
  });

  it("uses accessible live regions, close behavior, and pause interactions", () => {
    expect(component).toContain('role={toast.type === "warning" || toast.type === "error" ? "alert" : "status"}');
    expect(component).toContain('aria-live={toast.type === "warning" || toast.type === "error" ? "assertive" : "polite"}');
    expect(component).toContain('aria-atomic="true"');
    expect(component).toContain('onMouseEnter={() => controller.pause(toast.id, "hover")}');
    expect(component).toContain('onFocus={() => controller.pause(toast.id, "focus")}');
    expect(component).toContain("controller.dismiss(toast.id)");
  });

  it("uses the approved semantic colors, compact placement, and reduced motion", () => {
    for (const color of [
      "#f0fdf4", "#bbf7d0", "#15803d", "#14532d",
      "#eff6ff", "#bfdbfe", "#2563eb", "#1e3a8a",
      "#fff7ed", "#fed7aa", "#d97706", "#7c2d12",
      "#fef2f2", "#fecaca", "#dc2626", "#7f1d1d",
    ]) {
      expect(toastStyles).toContain(color);
    }
    expect(toastStyles).toContain("top: calc(var(--cd-header-height, 76px) + 16px)");
    expect(toastStyles).toContain("width: min(360px, calc(100vw - 32px))");
    expect(toastStyles).toContain("gap: 10px");
    expect(toastStyles).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
