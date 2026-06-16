import type { PublicQrCartItem } from "../types";
import { formatETBPrice } from "../../qr-menu/components/menuPresentation";

type PublicQrCheckoutPanelProps = {
  customerName: string;
  displaySubtotal: number;
  items: PublicQrCartItem[];
  submitting: boolean;
  submitError?: string;
  tableNumber?: string;
  onClose?: () => void;
  onCustomerNameChange: (customerName: string) => void;
  onSubmit: () => void;
};

const MIN_CUSTOMER_NAME_LENGTH = 2;
const MAX_CUSTOMER_NAME_LENGTH = 30;

function getCustomerNameValidationMessage(customerName: string) {
  const trimmedName = customerName.trim();

  if (trimmedName.length === 0) {
    return "Please enter your name before placing the order.";
  }

  if (trimmedName.length < MIN_CUSTOMER_NAME_LENGTH) {
    return "Name must be at least 2 characters.";
  }

  if (trimmedName.length > MAX_CUSTOMER_NAME_LENGTH) {
    return "Name must be 30 characters or fewer.";
  }

  return undefined;
}

export function PublicQrCheckoutPanel({
  customerName,
  displaySubtotal,
  items,
  submitting,
  submitError,
  tableNumber,
  onClose,
  onCustomerNameChange,
  onSubmit,
}: PublicQrCheckoutPanelProps) {
  const customerNameValidationMessage = getCustomerNameValidationMessage(customerName);
  const canSubmit = items.length > 0 && !submitting && !customerNameValidationMessage;

  return (
    <section className="public-checkout-panel open" aria-label="Checkout">
      <div className="public-checkout-heading">
        <div>
          <p className="eyebrow">Review Order</p>
          <h2>Checkout</h2>
        </div>
        <div className="checkout-heading-actions">
          {tableNumber ? <span>Table {tableNumber}</span> : <span>QR table order</span>}
          {onClose ? (
            <button className="panel-close-button" type="button" onClick={onClose} aria-label="Close checkout">
              Close
            </button>
          ) : null}
        </div>
      </div>

      <label className="public-checkout-field">
        <span>Your Name</span>
        <input
          type="text"
          value={customerName}
          placeholder="Abebe"
          autoComplete="name"
          maxLength={MAX_CUSTOMER_NAME_LENGTH + 1}
          aria-invalid={customerNameValidationMessage ? "true" : "false"}
          aria-describedby="public-checkout-name-error"
          onChange={(event) => onCustomerNameChange(event.target.value)}
          onBlur={() => onCustomerNameChange(customerName.trim())}
        />
        {customerNameValidationMessage ? (
          <p className="public-checkout-field-error" id="public-checkout-name-error">
            {customerNameValidationMessage}
          </p>
        ) : null}
      </label>

      <div className="public-checkout-summary" aria-label="Order summary">
        <h3>Order summary</h3>
        <div className="public-checkout-lines">
          {items.map((item) => (
            <div className="public-checkout-line" key={item.menuItemId}>
              <div>
                <strong>{item.name}</strong>
                <span>
                  {item.quantity} x {formatETBPrice(item.price)}
                </span>
              </div>
              <strong>{formatETBPrice(item.price * item.quantity)}</strong>
            </div>
          ))}
        </div>
        <div className="public-checkout-estimate">
          <span>Preparation estimate</span>
          <strong>15-20 min</strong>
        </div>
        <div className="public-checkout-total">
          <span>Subtotal</span>
          <strong>{formatETBPrice(displaySubtotal)}</strong>
        </div>
      </div>

      {submitError ? <p className="public-checkout-error">{submitError}</p> : null}

      <button
        className="public-checkout-submit-button"
        type="button"
        disabled={!canSubmit}
        onClick={onSubmit}
      >
        {submitting ? "Placing order..." : "Place order"}
      </button>
    </section>
  );
}
