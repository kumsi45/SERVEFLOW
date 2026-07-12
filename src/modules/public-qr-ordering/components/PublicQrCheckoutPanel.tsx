import {
  PUBLIC_QR_PAYMENT_METHODS,
  type PublicQrCartItem,
  type PublicQrPaymentMethod,
  type PublicQrOrderSession,
} from "../types";
import { formatETBPrice } from "../../qr-menu/components/menuPresentation";

type PublicQrCheckoutPanelProps = {
  customerName: string;
  displaySubtotal: number;
  activeSession?: PublicQrOrderSession | null;
  items: PublicQrCartItem[];
  paymentMethod: PublicQrPaymentMethod | "";
  submitting: boolean;
  submitError?: string;
  restaurantName?: string;
  tableNumber: string;
  tableCount?: number | null;
  tableNumberFromQr: boolean;
  onClose?: () => void;
  onCustomerNameChange: (customerName: string) => void;
  onTableNumberChange: (tableNumber: string) => void;
  onPaymentMethodChange: (paymentMethod: PublicQrPaymentMethod | "") => void;
  onSubmit: () => void;
};

const MAX_CUSTOMER_NAME_LENGTH = 30;

function getTableNumberValidationMessage(tableNumber: string, tableCount?: number | null) {
  const normalizedTableNumber = tableNumber.trim();

  if (!normalizedTableNumber) {
    return "Table number is required to place your order.";
  }

  if (!/^[0-9]+$/.test(normalizedTableNumber)) {
    return "Table number must be a whole number.";
  }

  const numericTableNumber = Number(normalizedTableNumber);

  const tableLimit = tableCount ?? 20;

  if (numericTableNumber < 1 || numericTableNumber > tableLimit) {
    return `Invalid table number. Please enter a table number between 1 and ${tableLimit}.`;
  }

  return undefined;
}

function getPaymentMethodValidationMessage(paymentMethod: PublicQrPaymentMethod | "") {
  if (!paymentMethod) {
    return "Please select a payment method before placing the order.";
  }
  return undefined;
}

export function PublicQrCheckoutPanel({
  customerName,
  displaySubtotal,
  activeSession,
  items,
  paymentMethod,
  submitting,
  submitError,
  restaurantName,
  tableNumber,
  tableCount,
  tableNumberFromQr,
  onClose,
  onCustomerNameChange,
  onTableNumberChange,
  onPaymentMethodChange,
  onSubmit,
}: PublicQrCheckoutPanelProps) {
  const tableNumberValidationMessage = getTableNumberValidationMessage(tableNumber, tableCount);
  const paymentMethodValidationMessage = getPaymentMethodValidationMessage(paymentMethod);
  const canSubmit =
    items.length > 0 &&
    !submitting &&
    !tableNumberValidationMessage &&
    !paymentMethodValidationMessage;

  const existingSubtotal = activeSession?.total_price ?? 0;
  const grandTotal = existingSubtotal + displaySubtotal;
  const isContinuingOrder = Boolean(activeSession);
  const activeOrderLabel = activeSession?.display_number ?? activeSession?.dining_session_display_number ?? "Current order";

  return (
    <section className="public-checkout-panel open" aria-label="Checkout">
      <div className="public-checkout-heading">
        <div>
          <p className="eyebrow">{isContinuingOrder ? "Continue Ordering" : "Review Order"}</p>
          <h2>{isContinuingOrder ? activeOrderLabel : "Checkout"}</h2>
          {restaurantName ? <p>{restaurantName}</p> : null}
        </div>
        <div className="checkout-heading-actions">
          {tableNumber
            ? <span style={{ fontWeight: 700, color: "var(--cd-accent, #1e5b4c)" }}>Table {tableNumber}</span>
            : <span>Select table</span>
          }
          {onClose ? (
            <button className="panel-close-button" type="button" onClick={onClose} aria-label="Close checkout">
              Close
            </button>
          ) : null}
        </div>
      </div>

      {/* Table Number — primary required field */}
      <label className="public-checkout-field">
        <span>Table Number *</span>
        {tableNumberFromQr ? (
          <input
            type="text"
            value={tableNumber}
            readOnly
            aria-label="Table number (pre-filled from QR code)"
            aria-invalid={tableNumberValidationMessage ? "true" : "false"}
            aria-describedby="public-checkout-table-error"
            style={
              tableNumberValidationMessage
                ? { background: "#fef2f2", borderColor: "#fecaca", color: "#b91c1c", fontWeight: 700 }
                : { background: "#f0fdf4", borderColor: "#bbf7d0", color: "#15803d", fontWeight: 700 }
            }
          />
        ) : (
          <input
            type="text"
            value={tableNumber}
            placeholder="Enter your table number"
            aria-invalid={tableNumberValidationMessage ? "true" : "false"}
            aria-describedby="public-checkout-table-error"
            onChange={(event) => onTableNumberChange(event.target.value)}
            onBlur={() => onTableNumberChange(tableNumber.trim())}
          />
        )}
        {tableNumberFromQr && !tableNumberValidationMessage ? (
          <p style={{ fontSize: 12, color: "#15803d", fontWeight: 600, margin: 0 }}>
            Auto-detected from your table QR code
          </p>
        ) : null}
        {tableNumberValidationMessage ? (
          <p className="public-checkout-field-error" id="public-checkout-table-error">
            {tableNumberValidationMessage}
          </p>
        ) : null}
      </label>

      {/* Customer Name — optional */}
      <label className="public-checkout-field">
        <span>Customer Name <span style={{ fontSize: 11, color: "var(--lp-muted, #94a3b8)", fontWeight: 400 }}>(Optional)</span></span>
        <input
          type="text"
          value={customerName}
          placeholder="Enter your name if you'd like staff to identify you"
          autoComplete="name"
          maxLength={MAX_CUSTOMER_NAME_LENGTH + 1}
          onChange={(event) => onCustomerNameChange(event.target.value)}
          onBlur={() => onCustomerNameChange(customerName.trim())}
        />
      </label>

      {/* Payment Method */}
      <label className="public-checkout-field">
        <span>Payment Method *</span>
        <select
          value={paymentMethod}
          aria-invalid={paymentMethodValidationMessage ? "true" : "false"}
          aria-describedby="public-checkout-payment-error"
          onChange={(event) =>
            onPaymentMethodChange(event.target.value as PublicQrPaymentMethod | "")
          }
        >
          <option value="">Select payment method</option>
          {PUBLIC_QR_PAYMENT_METHODS.map((method) => (
            <option value={method} key={method}>
              {method}
            </option>
          ))}
        </select>
        {paymentMethodValidationMessage ? (
          <p className="public-checkout-field-error" id="public-checkout-payment-error">
            {paymentMethodValidationMessage}
          </p>
        ) : null}
      </label>

      {/* Order summary */}
      <div className="public-checkout-summary" aria-label="Order summary">
        <h3>{isContinuingOrder ? "Current order" : "Order summary"}</h3>
        {activeSession ? (
          <>
            <div className="public-checkout-lines readonly">
              {activeSession.items.map((item) => (
                <div className="public-checkout-line existing" key={item.id}>
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
            <div className="public-checkout-total subtle">
              <span>Current subtotal</span>
              <strong>{formatETBPrice(existingSubtotal)}</strong>
            </div>
          </>
        ) : null}
        {activeSession ? <h3>New items</h3> : null}
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
          <span>{isContinuingOrder ? "Grand total" : "Subtotal"}</span>
          <strong>{formatETBPrice(isContinuingOrder ? grandTotal : displaySubtotal)}</strong>
        </div>
      </div>

      <div className="public-checkout-footer">
        {submitError ? <p className="public-checkout-error">{submitError}</p> : null}
        <button
          className="public-checkout-submit-button"
          type="button"
          disabled={!canSubmit}
          onClick={onSubmit}
        >
          {submitting ? (
            <span className="submit-progress">
              <span className="status-pulse" aria-hidden="true" />
              {isContinuingOrder ? "Adding items..." : "Sending order..."}
            </span>
          ) : (
            isContinuingOrder ? "Add to Current Order" : "Place Order"
          )}
        </button>
      </div>
    </section>
  );
}
