import type { PublicQrCartItem } from "../types";

type PublicQrCheckoutPanelProps = {
  customerName: string;
  displaySubtotal: number;
  items: PublicQrCartItem[];
  submitting: boolean;
  submitError?: string;
  tableNumber?: string;
  onCustomerNameChange: (customerName: string) => void;
  onSubmit: () => void;
};

const currencyFormatter = new Intl.NumberFormat("en", {
  style: "currency",
  currency: "USD",
});

export function PublicQrCheckoutPanel({
  customerName,
  displaySubtotal,
  items,
  submitting,
  submitError,
  tableNumber,
  onCustomerNameChange,
  onSubmit,
}: PublicQrCheckoutPanelProps) {
  return (
    <section className="public-checkout-panel" aria-label="Checkout">
      <div className="public-checkout-heading">
        <h2>Checkout</h2>
        {tableNumber ? <span>Table {tableNumber}</span> : null}
      </div>

      <label className="public-checkout-field">
        <span>Name</span>
        <input
          type="text"
          value={customerName}
          placeholder="Optional"
          autoComplete="name"
          onChange={(event) => onCustomerNameChange(event.target.value)}
        />
      </label>

      <div className="public-checkout-summary" aria-label="Order summary">
        <h3>Order summary</h3>
        <div className="public-checkout-lines">
          {items.map((item) => (
            <div className="public-checkout-line" key={item.menuItemId}>
              <div>
                <strong>{item.name}</strong>
                <span>
                  {item.quantity} x {currencyFormatter.format(item.price)}
                </span>
              </div>
              <strong>{currencyFormatter.format(item.price * item.quantity)}</strong>
            </div>
          ))}
        </div>
        <div className="public-checkout-total">
          <span>Subtotal</span>
          <strong>{currencyFormatter.format(displaySubtotal)}</strong>
        </div>
      </div>

      {submitError ? <p className="public-checkout-error">{submitError}</p> : null}

      <button
        className="public-checkout-submit-button"
        type="button"
        disabled={submitting || items.length === 0}
        onClick={onSubmit}
      >
        {submitting ? "Placing order..." : "Place order"}
      </button>
    </section>
  );
}
