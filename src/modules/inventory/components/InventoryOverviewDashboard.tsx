import type { InventoryLedgerEntry, InventorySection } from "../types";
import { partitionInventoryKitchenRequests, type InventoryKitchenQueueRequest } from "../services/inventoryKitchenRequestService";

type Props = {
  requests: InventoryKitchenQueueRequest[];
  requestsLoading: boolean;
  requestsLoaded: boolean;
  requestsError: string | null;
  stockLoading: boolean;
  stockError: string | null;
  activityLoading: boolean;
  activityError: string | null;
  purchasesLoading: boolean;
  purchasesLoaded: boolean;
  purchasesError: string | null;
  outOfStockCount: number;
  lowStockCount: number;
  pendingPurchaseCount: number;
  totalActiveMaterials: number;
  recentLedger: InventoryLedgerEntry[];
  onNavigate: (section: InventorySection) => void;
  onOpenRequests: () => void;
};

export function inventoryAttentionValue(count: number, loading: boolean, loaded: boolean, error: string | null) {
  return error || (loading && !loaded) ? "—" : count;
}

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
  requestsLoaded,
  requestsError,
  stockLoading,
  stockError,
  activityLoading,
  activityError,
  purchasesLoading,
  purchasesLoaded,
  purchasesError,
  outOfStockCount,
  lowStockCount,
  pendingPurchaseCount,
  totalActiveMaterials,
  recentLedger,
  onNavigate,
  onOpenRequests,
}: Props) {
  const kitchenRequestCount = partitionInventoryKitchenRequests(requests).awaitingInventory.length;
  const kitchenRequestValue = inventoryAttentionValue(kitchenRequestCount, requestsLoading, requestsLoaded, requestsError);
  const pendingPurchaseValue = inventoryAttentionValue(pendingPurchaseCount, purchasesLoading, purchasesLoaded, purchasesError);

  return (
    <div className="ia-stack ia-i2-dashboard">
      <section className="ia-i2-section" aria-labelledby="i2-attention-title">
        <div className="ia-i2-title"><div><h2 id="i2-attention-title">Needs Attention</h2></div></div>
        <div className="ia-i2-attention-grid">
          <button className={kitchenRequestValue === "—" ? "is-unavailable" : ""} type="button" onClick={onOpenRequests}>
            <strong aria-live="polite">{kitchenRequestValue}</strong><span>Kitchen Requests</span>
          </button>
          <button className={pendingPurchaseValue === "—" ? "is-unavailable" : ""} type="button" onClick={() => onNavigate("purchase-orders")}>
            <strong aria-live="polite">{pendingPurchaseValue}</strong><span>Pending Purchases</span>
          </button>
        </div>
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
