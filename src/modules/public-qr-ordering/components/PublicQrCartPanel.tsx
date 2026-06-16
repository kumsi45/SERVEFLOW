import type { PublicQrCartItem } from "../types";
import { formatETBPrice } from "../../qr-menu/components/menuPresentation";

type PublicQrCartPanelProps = {
  items: PublicQrCartItem[];
  itemCount: number;
  displaySubtotal: number;
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

  return (
    <aside className={isOpen ? "public-cart-panel open" : "public-cart-panel"} aria-label="Cart">
      <div className="public-cart-heading">
        <div>
          <p className="eyebrow">Your order</p>
          <h2>Cart</h2>
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

      {items.length > 0 ? (
        <>
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
            <span>Subtotal</span>
            <strong>{formatETBPrice(displaySubtotal)}</strong>
          </div>
          <button className="public-cart-review-button" type="button" onClick={onReviewOrder}>
            Review order
          </button>
        </>
      ) : (
        <p className="public-cart-empty">No cart items yet. Start adding your favorite dishes.</p>
      )}
    </aside>
  );
}
