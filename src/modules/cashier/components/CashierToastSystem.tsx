import { useCallback, useEffect, useRef, useState } from "react";
import {
  CashierToastController,
  type CashierToast,
  type CashierToastInput,
} from "../cashierToast";
import { CashierIcon, type CashierIconName } from "./CashierDashboardUi";

const TOAST_ICONS: Record<CashierToast["type"], CashierIconName> = {
  success: "paid",
  information: "order",
  warning: "due",
  error: "cancel",
};

export function useCashierToasts() {
  const controllerRef = useRef<CashierToastController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new CashierToastController();
  }
  const controller = controllerRef.current;
  const [snapshot, setSnapshot] = useState(() => controller.getSnapshot());

  useEffect(() => controller.subscribe(setSnapshot), [controller]);
  useEffect(() => () => controller.destroy(), [controller]);

  const pushToast = useCallback(
    (toast: CashierToastInput) => controller.push(toast),
    [controller],
  );

  return { controller, pushToast, ...snapshot };
}

export function CashierToastViewport({
  toasts,
  controller,
}: {
  toasts: CashierToast[];
  controller: CashierToastController;
}) {
  if (toasts.length === 0) return null;

  return (
    <section className="cd-toast-viewport" aria-label="Cashier notifications">
      {toasts.map((toast) => (
        <article
          key={toast.id}
          className={`cd-toast ${toast.type}${toast.exiting ? " exiting" : ""}`}
          role={toast.type === "warning" || toast.type === "error" ? "alert" : "status"}
          aria-live={toast.type === "warning" || toast.type === "error" ? "assertive" : "polite"}
          aria-atomic="true"
          tabIndex={0}
          data-paused={toast.paused ? "true" : "false"}
          onMouseEnter={() => controller.pause(toast.id, "hover")}
          onMouseLeave={() => controller.resume(toast.id, "hover")}
          onFocus={() => controller.pause(toast.id, "focus")}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              controller.resume(toast.id, "focus");
            }
          }}
        >
          <span className="cd-toast-icon" aria-hidden="true">
            <CashierIcon name={TOAST_ICONS[toast.type]} />
          </span>
          <span className="cd-toast-content">
            <strong>{toast.title}</strong>
            {toast.description ? <span>{toast.description}</span> : null}
          </span>
          <button
            type="button"
            className="cd-toast-close"
            aria-label={`Dismiss ${toast.title} notification`}
            onClick={() => controller.dismiss(toast.id)}
          >
            <span aria-hidden="true">×</span>
          </button>
        </article>
      ))}
    </section>
  );
}
