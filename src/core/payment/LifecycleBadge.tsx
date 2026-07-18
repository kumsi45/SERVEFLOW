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

export function CanonicalLifecycleStatus({
  operationalStatus,
  paymentStatus,
  kitchenProgress,
}: {
  operationalStatus: unknown;
  paymentStatus: unknown;
  kitchenProgress?: string | null;
}) {
  return (
    <div className="sf-canonical-lifecycle" aria-label="Canonical order lifecycle">
      <span><small>Operational</small><OperationalStatusBadge status={operationalStatus} /></span>
      <span><small>Payment</small><PaymentStatusBadge status={paymentStatus} /></span>
      <span><small>Kitchen</small><OperationalStatusBadge status={kitchenProgress ?? operationalStatus} /></span>
    </div>
  );
}
