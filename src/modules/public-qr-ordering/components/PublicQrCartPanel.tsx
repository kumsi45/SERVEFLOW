import type { PublicQrCartItem, PublicQrOrderSession } from "../types";
import { formatETBPrice } from "../../qr-menu/components/menuPresentation";

type PublicQrCartPanelProps = {
  items: PublicQrCartItem[];
  itemCount: number;
  displaySubtotal: number;
  activeSession?: PublicQrOrderSession | null;
  isFloatingOnly?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
  onIncrease: (menuItemId: string, quantity: number) => void;
  onDecrease: (menuItemId: string, quantity: number) => void;
  onRemove: (menuItemId: string) => void;
  onReviewOrder: () => void;
};

export function PublicQrCartPanel({
  items,
  itemCount,
  displaySubtotal,
  activeSession,
  isFloatingOnly = false,
  isOpen = false,
  onClose,
  onIncrease,
  onDecrease,
  onRemove,
  onReviewOrder,
}: PublicQrCartPanelProps) {
  if (isFloatingOnly) {
    return null;
  }

  const existingSubtotal = activeSession?.total_price ?? 0;
  const grandTotal = existingSubtotal + displaySubtotal;
  const hasActiveSession = Boolean(activeSession);
  const activeOrderLabel = activeSession?.display_number ?? activeSession?.dining_session_display_number ?? "Current order";

  return (
    <aside className={isOpen ? "public-cart-panel open" : "public-cart-panel"} aria-label="Cart">
      <div className="public-cart-heading">
        <div>
          <p className="eyebrow">{hasActiveSession ? "Current order" : "Your order"}</p>
          <h2>{hasActiveSession ? activeOrderLabel : "Cart"}</h2>
        </div>
        <span>
          {itemCount} {itemCount === 1 ? "item" : "items"}
        </span>
        {onClose ? (
          <button className="panel-close-button" type="button" onClick={onClose} aria-label="Close cart">
            Close
          </button>
        ) : null}
      </div>

      {activeSession ? (
        <div className="public-session-summary">
          <div className="public-session-lines">
            {activeSession.items.map((item) => (
              <div className="public-session-line" key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <span>
                    {item.quantity} x {formatETBPrice(item.unit_price)}
                  </span>
                </div>
                <strong>{formatETBPrice(item.line_total)}</strong>
              </div>
            ))}
          </div>
          <div className="public-cart-total subtle">
            <span>Current subtotal</span>
            <strong>{formatETBPrice(existingSubtotal)}</strong>
          </div>
        </div>
      ) : null}

      {items.length > 0 ? (
        <>
          {hasActiveSession ? <p className="public-cart-section-label">New items</p> : null}
          <div className="public-cart-lines">
            {items.map((item) => (
              <div className="public-cart-line" key={item.menuItemId}>
                <div className="public-cart-line-main">
                  <div>
                    <strong>{item.name}</strong>
                    {item.notes ? <p>{item.notes}</p> : null}
                  </div>
                  <span>{formatETBPrice(item.price * item.quantity)}</span>
                </div>
                <div className="public-cart-actions">
                  <button
                    type="button"
                    aria-label={`Decrease ${item.name} quantity`}
                    onClick={() => onDecrease(item.menuItemId, item.quantity)}
                    disabled={item.quantity <= 1}
                  >
                    -
                  </button>
                  <span>{item.quantity}</span>
                  <button
                    type="button"
                    aria-label={`Increase ${item.name} quantity`}
                    onClick={() => onIncrease(item.menuItemId, item.quantity)}
                  >
                    +
                  </button>
                  <button type="button" onClick={() => onRemove(item.menuItemId)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="public-cart-total">
            <span>{hasActiveSession ? "Grand total" : "Subtotal"}</span>
            <strong>{formatETBPrice(hasActiveSession ? grandTotal : displaySubtotal)}</strong>
          </div>
          <button className="public-cart-review-button" type="button" onClick={onReviewOrder}>
            {hasActiveSession ? "Continue Ordering" : "Review order"}
          </button>
        </>
      ) : (
        <div className="public-cart-empty">
          <div className="empty-state-icon" aria-hidden="true">+</div>
          <h3>{hasActiveSession ? "Add more when you're ready" : "Your cart is empty"}</h3>
          <p>{hasActiveSession ? "Previously confirmed items stay on this order. New items will be added separately." : "Start with a favorite dish, then review everything here before placing your order."}</p>
        </div>
      )}
    </aside>
  );
}
