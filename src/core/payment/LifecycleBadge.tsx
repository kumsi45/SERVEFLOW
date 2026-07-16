import { canonicalOperationalStatus, canonicalPaymentStatus, operationalLabel, paymentLabel } from "./lifecycle";
import "./lifecycle.css";

export function OperationalStatusBadge({ status }: { status: unknown }) {
  const canonical = canonicalOperationalStatus(status);
  return <span className={`sf-status-badge sf-operational-${canonical}`}>{operationalLabel(canonical)}</span>;
}
export function PaymentStatusBadge({ status }: { status: unknown }) {
  const canonical = canonicalPaymentStatus(status);
  return <span className={`sf-status-badge sf-payment-${canonical}`}>{paymentLabel(canonical)}</span>;
}
