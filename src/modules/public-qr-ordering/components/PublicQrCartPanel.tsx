import type { PublicQrCartItem } from "../types";

type PublicQrCartPanelProps = {
  items: PublicQrCartItem[];
  itemCount: number;
  displaySubtotal: number;
  onIncrease: (menuItemId: string, quantity: number) => void;
  onDecrease: (menuItemId: string, quantity: number) => void;
  onRemove: (menuItemId: string) => void;
  onReviewOrder: () => void;
};

const currencyFormatter = new Intl.NumberFormat("en", {
  style: "currency",
  currency: "USD",
});

export function PublicQrCartPanel({
  items,
  itemCount,
  displaySubtotal,
  onIncrease,
  onDecrease,
  onRemove,
  onReviewOrder,
}: PublicQrCartPanelProps) {
  return (
    <aside className="public-cart-panel" aria-label="Cart">
      <div className="public-cart-heading">
        <h2>Cart</h2>
        <span>
          {itemCount} {itemCount === 1 ? "item" : "items"}
        </span>
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
                  <span>{currencyFormatter.format(item.price * item.quantity)}</span>
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
            <strong>{currencyFormatter.format(displaySubtotal)}</strong>
          </div>
          <button className="public-cart-review-button" type="button" onClick={onReviewOrder}>
            Review order
          </button>
        </>
      ) : (
        <p className="public-cart-empty">No items added yet.</p>
      )}
    </aside>
  );
}
