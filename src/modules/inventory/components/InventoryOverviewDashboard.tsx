import type { InventoryLedgerEntry, InventorySection } from "../types";
import type { InventoryKitchenQueueRequest } from "../services/inventoryKitchenRequestService";

type Props = {
  requests: InventoryKitchenQueueRequest[];
  requestsLoading: boolean;
  requestsError: string | null;
  stockLoading: boolean;
  stockError: string | null;
  activityLoading: boolean;
  activityError: string | null;
  purchasesLoading: boolean;
  purchasesError: string | null;
  outOfStockCount: number;
  lowStockCount: number;
  pendingPurchaseCount: number;
  totalActiveMaterials: number;
  recentLedger: InventoryLedgerEntry[];
  onNavigate: (section: InventorySection) => void;
  onOpenRequests: () => void;
};

const quantityLabel = (value: number, unit: string) => {
  const amount = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);
  return unit.trim() ? `${amount} ${unit.trim()}` : amount;
};

const dateTimeLabel = (value: string) => new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
}).format(new Date(value));

export function inventoryMovementBusinessLabel(value: InventoryLedgerEntry["movementType"]) {
  const labels: Record<InventoryLedgerEntry["movementType"], string> = {
    opening_balance: "Opening balance",
    stock_in: "Received",
    stock_out: "Issued",
    transfer_in: "Transfer received",
    transfer_out: "Transferred",
    adjustment_increase: "Stock increased",
    adjustment_decrease: "Stock reduced",
    waste: "Waste recorded",
    spoilage: "Spoilage recorded",
    manual_correction: "Stock corrected",
    closing_balance: "Closing balance",
  };
  return labels[value];
}

export function InventoryOverviewDashboard({
  requests,
  requestsLoading,
  requestsError,
  stockLoading,
  stockError,
  activityLoading,
  activityError,
  purchasesLoading,
  purchasesError,
  outOfStockCount,
  lowStockCount,
  pendingPurchaseCount,
  totalActiveMaterials,
  recentLedger,
  onNavigate,
  onOpenRequests,
}: Props) {
  const kitchenRequestCount = requests.filter((request) => request.status === "accepted").length;
  const knownActionCount = (requestsLoading || requestsError ? 0 : kitchenRequestCount)
    + (stockLoading || stockError ? 0 : outOfStockCount + lowStockCount)
    + (purchasesLoading || purchasesError ? 0 : pendingPurchaseCount);
  const attentionLoading = requestsLoading || stockLoading || purchasesLoading;
  const attentionUnavailable = Boolean(requestsError || stockError || purchasesError);
  const attentionConfirmed = !attentionLoading && !attentionUnavailable;

  return (
    <div className="ia-stack ia-i2-dashboard">
      <section className="ia-i2-section" aria-labelledby="i2-attention-title">
        <div className="ia-i2-title"><div><h2 id="i2-attention-title">Needs Attention</h2></div></div>
        {attentionLoading && knownActionCount === 0 && (
          <div className="ia-i2-loading" role="status">Loading inventory overview...</div>
        )}
        {attentionConfirmed && knownActionCount === 0 && (
          <div className="ia-i2-healthy"><strong>No inventory actions require attention.</strong></div>
        )}
        {knownActionCount > 0 && <div className="ia-i2-attention-grid">
          {!requestsLoading && !requestsError && kitchenRequestCount > 0 && <button type="button" onClick={onOpenRequests}>
            <strong>{kitchenRequestCount}</strong><span>Kitchen Requests</span>
          </button>}
          {!stockLoading && !stockError && outOfStockCount > 0 && <button className="critical" type="button" onClick={() => onNavigate("current-stock")}>
            <strong>{outOfStockCount}</strong><span>Out of Stock</span>
          </button>}
          {!stockLoading && !stockError && lowStockCount > 0 && <button className="warning" type="button" onClick={() => onNavigate("current-stock")}>
            <strong>{lowStockCount}</strong><span>Low Stock</span>
          </button>}
          {!purchasesLoading && !purchasesError && pendingPurchaseCount > 0 && <button type="button" onClick={() => onNavigate("purchase-orders")}>
            <strong>{pendingPurchaseCount}</strong><span>Pending Purchases</span>
          </button>}
        </div>}
        {attentionUnavailable && <div className="ia-i2-section-errors" role="status">
          {requestsError && <span>Kitchen requests unavailable.</span>}
          {stockError && <span>Stock summary unavailable.</span>}
          {purchasesError && <span>Purchase summary unavailable.</span>}
        </div>}
      </section>

      <section className="ia-i2-section" aria-labelledby="i2-actions-title">
        <div className="ia-i2-title"><div><h2 id="i2-actions-title">Quick Operations</h2></div></div>
        <div className="ia-i2-quick-grid">
          <button type="button" onClick={() => onNavigate("stock-in")}><span>+</span><strong>Receive</strong></button>
          <button type="button" onClick={() => onNavigate("stock-out")}><span>−</span><strong>Issue</strong></button>
          <button type="button" onClick={() => onNavigate("transfers")}><span>⇄</span><strong>Transfer</strong></button>
          <button type="button" onClick={() => onNavigate("adjustments")}><span>±</span><strong>Adjust</strong></button>
          <button type="button" onClick={() => onNavigate("waste")}><span>!</span><strong>Waste</strong></button>
          <button type="button" onClick={() => onNavigate("purchase-orders")}><span>PO</span><strong>Purchase Order</strong></button>
        </div>
      </section>

      <section className="ia-i2-section" aria-labelledby="i2-stock-title">
        <div className="ia-i2-title"><div><h2 id="i2-stock-title">Stock Snapshot</h2></div><button type="button" onClick={() => onNavigate("current-stock")}>Current Stock</button></div>
        {stockLoading ? <div className="ia-i2-loading" role="status">Loading stock summary...</div>
          : stockError ? <div className="ia-i2-error" role="alert"><strong>Unable to load stock summary.</strong><span>Try again.</span></div>
            : <div className="ia-i2-snapshot-grid">
              <button type="button" onClick={() => onNavigate("items")}><small>Active Materials</small><strong>{totalActiveMaterials}</strong></button>
              <button type="button" onClick={() => onNavigate("current-stock")}><small>Out of Stock</small><strong>{outOfStockCount}</strong></button>
              <button type="button" onClick={() => onNavigate("current-stock")}><small>Low Stock</small><strong>{lowStockCount}</strong></button>
            </div>}
      </section>

      <section className="ia-i2-section" aria-labelledby="i2-activity-title">
        <div className="ia-i2-title"><div><h2 id="i2-activity-title">Recent Activity</h2></div><button type="button" onClick={() => onNavigate("ledger")}>View Movements</button></div>
        {activityLoading ? <div className="ia-i2-loading" role="status">Loading recent activity...</div>
          : activityError ? <div className="ia-i2-error" role="alert"><strong>Unable to load recent activity.</strong><span>Try again.</span></div>
            : recentLedger.length === 0 ? <p className="ia-i2-empty">No recent stock activity.</p>
              : <div className="ia-i2-activity-list">{recentLedger.slice(0, 6).map((entry) => (
                <button type="button" key={entry.id} onClick={() => onNavigate("ledger")}>
                  <span className={`ia-i2-direction ${entry.quantityEffect === "in" ? "in" : "out"}`}>{entry.quantityEffect === "in" ? "+" : "−"}</span>
                  <span className="ia-i2-activity-main"><strong>{entry.itemName}</strong><small>{inventoryMovementBusinessLabel(entry.movementType)} · {entry.storageLocationName}</small></span>
                  <strong className={entry.quantityEffect === "in" ? "in" : "out"}>{entry.quantityEffect === "in" ? "+" : "−"}{quantityLabel(entry.quantity, entry.unitName)}</strong>
                  <span className="ia-i2-activity-meta"><strong>{entry.staffName ?? "Inventory staff"}</strong><time dateTime={entry.movementDate}>{dateTimeLabel(entry.movementDate)}</time></span>
                </button>
              ))}</div>}
      </section>
    </div>
  );
}
