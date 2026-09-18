import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useModalFocus } from "../../../../core/accessibility/useModalFocus";
import {
  loadInventoryRequests,
  type InventoryRequest,
} from "../../../kitchen/services/inventoryRequestService";
import { loadCurrentStock } from "../../../inventory/services/inventoryBalanceService";
import { loadLedger } from "../../../inventory/services/ledgerService";
import type {
  InventoryCurrentStockRow,
  InventoryLedgerEntry,
} from "../../../inventory/types";

type Props = { restaurantId: string; onManageInventory: () => void };
type StockFilter = "all" | "low_stock" | "out_of_stock";

const ACTIVITY_LIMIT = 12;
const number = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);
const quantity = (value: number, unit: string) =>
  `${number(value)}${unit ? ` ${unit}` : ""}`;
const time = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
const movementLabel: Record<InventoryLedgerEntry["movementType"], string> = {
  opening_balance: "Opening balance",
  stock_in: "Stock received",
  stock_out: "Stock out",
  transfer_in: "Transfer received",
  transfer_out: "Transfer sent",
  adjustment_increase: "Adjustment increase",
  adjustment_decrease: "Adjustment decrease",
  waste: "Waste",
  spoilage: "Spoilage",
  manual_correction: "Stock correction",
  closing_balance: "Closing balance",
};

function StockStatus({
  status,
}: {
  status: InventoryCurrentStockRow["stockStatus"];
}) {
  const label =
    status === "out_of_stock"
      ? "Out of stock"
      : status === "low_stock"
        ? "Low stock"
        : status === "over_stock"
          ? "Over stock"
          : "In stock";
  return <span className={`od-inventory-status ${status}`}>{label}</span>;
}

export function OwnerInventoryPage({ restaurantId, onManageInventory }: Props) {
  const [stock, setStock] = useState<InventoryCurrentStockRow[]>([]);
  const [requests, setRequests] = useState<InventoryRequest[]>([]);
  const [activity, setActivity] = useState<InventoryLedgerEntry[]>([]);
  const [stockState, setStockState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [requestsState, setRequestsState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [activityState, setActivityState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StockFilter>("all");
  const [attentionExpanded, setAttentionExpanded] = useState(false);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] =
    useState<InventoryRequest | null>(null);
  const requestSheetRef = useRef<HTMLElement>(null);
  const requestCloseRef = useRef<HTMLButtonElement>(null);

  const refreshStock = useCallback(async () => {
    setStockState((state) => (state === "ready" ? state : "loading"));
    try {
      setStock(await loadCurrentStock(restaurantId));
      setStockState("ready");
    } catch {
      setStockState("error");
    }
  }, [restaurantId]);
  const refreshRequests = useCallback(async () => {
    setRequestsState((state) => (state === "ready" ? state : "loading"));
    try {
      setRequests(await loadInventoryRequests(restaurantId));
      setRequestsState("ready");
    } catch {
      setRequestsState("error");
    }
  }, [restaurantId]);
  const refreshActivity = useCallback(async () => {
    setActivityState((state) => (state === "ready" ? state : "loading"));
    try {
      setActivity(await loadLedger(restaurantId, { limit: ACTIVITY_LIMIT }));
      setActivityState("ready");
    } catch {
      setActivityState("error");
    }
  }, [restaurantId]);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refreshStock(), refreshRequests(), refreshActivity()]);
    setRefreshing(false);
  }, [refreshActivity, refreshRequests, refreshStock]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useModalFocus(
    requestsOpen,
    () => {
      setRequestsOpen(false);
      setSelectedRequest(null);
    },
    requestSheetRef,
    requestCloseRef,
  );

  const attention = useMemo(
    () =>
      stock
        .filter(
          (row) =>
            row.stockStatus === "out_of_stock" ||
            row.stockStatus === "low_stock",
        )
        .sort(
          (a, b) =>
            Number(a.stockStatus !== "out_of_stock") -
              Number(b.stockStatus !== "out_of_stock") ||
            a.itemName.localeCompare(b.itemName),
        ),
    [stock],
  );
  const pendingRequests = useMemo(
    () => requests.filter((request) => request.status === "pending"),
    [requests],
  );
  const visibleStock = useMemo(
    () =>
      stock.filter((row) => {
        const matchesStatus = filter === "all" || row.stockStatus === filter;
        const needle = query.trim().toLowerCase();
        return (
          matchesStatus &&
          (!needle ||
            `${row.itemName} ${row.categoryName ?? ""} ${row.storageLocationName}`
              .toLowerCase()
              .includes(needle))
        );
      }),
    [filter, query, stock],
  );
  const visibleAttention = attentionExpanded
    ? attention
    : attention.slice(0, 4);
  const unavailable = (state: typeof stockState) =>
    state === "error" ? "Unavailable" : state === "loading" ? "Loading" : null;

  return (
    <main className="od-page od-inventory-page">
      <header className="od-inventory-header">
        <h1>Inventory</h1>
        <div className="od-inventory-actions">
          <button
            className="od-btn-ghost"
            type="button"
            onClick={onManageInventory}
          >
            Manage inventory
          </button>
          <button
            className="od-btn-ghost od-inventory-refresh"
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            <RefreshCw
              aria-hidden="true"
              className={refreshing ? "spinning" : ""}
            />{" "}
            <span>{refreshing ? "Refreshing" : "Refresh"}</span>
          </button>
        </div>
      </header>

      <section className="od-inventory-summary" aria-label="Inventory summary">
        <div className="od-inventory-summary-warning">
          <span>Low stock</span>
          <strong>
            {unavailable(stockState) ??
              attention.filter((row) => row.stockStatus === "low_stock").length}
          </strong>
        </div>
        <div className="od-inventory-summary-critical">
          <span>Out of stock</span>
          <strong>
            {unavailable(stockState) ??
              attention.filter((row) => row.stockStatus === "out_of_stock")
                .length}
          </strong>
        </div>
        <div className="od-inventory-summary-pending">
          <span>Requests</span>
          <strong>
            {unavailable(requestsState) ?? pendingRequests.length}
          </strong>
        </div>
      </section>

      <section
        className="od-inventory-section od-inventory-attention-section"
        aria-labelledby="owner-inventory-attention"
      >
        <header>
          <h2 id="owner-inventory-attention">Needs attention</h2>
          {attention.length > 4 && stockState === "ready" && (
            <button
              type="button"
              className="od-btn-ghost"
              onClick={() => setAttentionExpanded((value) => !value)}
            >
              {attentionExpanded ? "Show less" : "View all"}
            </button>
          )}
        </header>
        {stockState === "loading" && (
          <p className="od-inventory-state">Loading inventory…</p>
        )}
        {stockState === "error" && (
          <div className="od-inventory-error">
            <span>Inventory unavailable</span>
            <button type="button" onClick={() => void refreshStock()}>
              Retry
            </button>
          </div>
        )}
        {stockState === "ready" &&
          (attention.length ? (
            <div className="od-inventory-attention-list">
              {visibleAttention.map((row) => (
                <div
                  className="od-inventory-attention-row"
                  key={`${row.inventoryItemId}:${row.storageLocationId}`}
                >
                  <div>
                    <strong>{row.itemName}</strong>
                    <span>
                      {quantity(row.currentQuantity, row.unitName)} available
                      {row.stockStatus === "low_stock"
                        ? ` · Minimum ${quantity(row.minimumStock, row.unitName)}`
                        : ""}
                    </span>
                  </div>
                  <StockStatus status={row.stockStatus} />
                </div>
              ))}
            </div>
          ) : (
            <p className="od-inventory-state positive">
              No stock items need attention
            </p>
          ))}
      </section>

      <section
        className="od-inventory-section od-inventory-stock-section"
        aria-labelledby="owner-inventory-stock"
      >
        <header className="od-inventory-stock-header">
          <h2 id="owner-inventory-stock">Stock</h2>
          <div className="od-inventory-filters od-inventory-stock-toolbar">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search inventory..."
              aria-label="Search inventory"
            />
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as StockFilter)}
              aria-label="Stock status"
            >
              <option value="all">All</option>
              <option value="low_stock">Low stock</option>
              <option value="out_of_stock">Out of stock</option>
            </select>
          </div>
        </header>
        {stockState === "error" ? (
          <div className="od-inventory-error">
            <span>Unable to load stock</span>
            <button type="button" onClick={() => void refreshStock()}>
              Retry
            </button>
          </div>
        ) : stockState === "loading" ? (
          <p className="od-inventory-state">Loading stock…</p>
        ) : stock.length === 0 ? (
          <p className="od-inventory-state">No inventory items yet</p>
        ) : (
          <div className="od-inventory-stock-list">
            {visibleStock.map((row) => (
              <article key={`${row.inventoryItemId}:${row.storageLocationId}`}>
                <div>
                  <strong>{row.itemName}</strong>
                  <span>{row.categoryName ?? row.storageLocationName}</span>
                </div>
                <b>{quantity(row.currentQuantity, row.unitName)}</b>
                <StockStatus status={row.stockStatus} />
              </article>
            ))}
            {visibleStock.length === 0 && (
              <p className="od-inventory-state">
                No inventory items match your search.
              </p>
            )}
          </div>
        )}
      </section>

      <section
        className="od-inventory-section od-inventory-requests-section"
        aria-labelledby="owner-inventory-requests"
      >
        <header>
          <div>
            <h2 id="owner-inventory-requests">Kitchen requests</h2>
            <span>
              {requestsState === "ready"
                ? `${pendingRequests.length} pending`
                : unavailable(requestsState)}
            </span>
          </div>
          <button
            type="button"
            className="od-btn-ghost"
            onClick={() => setRequestsOpen(true)}
          >
            View requests
          </button>
        </header>
        {requestsState === "error" ? (
          <div className="od-inventory-error">
            <span>Unable to load requests</span>
            <button type="button" onClick={() => void refreshRequests()}>
              Retry
            </button>
          </div>
        ) : requestsState === "loading" ? (
          <p className="od-inventory-state">Loading requests…</p>
        ) : pendingRequests.length ? (
          <div className="od-inventory-request-preview">
            {pendingRequests.slice(0, 3).map((request) => (
              <button
                key={request.id}
                type="button"
                onClick={() => {
                  setSelectedRequest(request);
                  setRequestsOpen(true);
                }}
              >
                <div>
                  <strong>{request.stationName ?? "Kitchen"}</strong>
                  <span>
                    {request.itemName} ·{" "}
                    {quantity(request.quantity, request.unit)}
                  </span>
                </div>
                <span className="od-inventory-status pending">Pending</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="od-inventory-state">No pending Kitchen requests</p>
        )}
      </section>

      <section
        className="od-inventory-section od-inventory-activity-section"
        aria-labelledby="owner-inventory-activity"
      >
        <header>
          <h2 id="owner-inventory-activity">Recent activity</h2>
        </header>
        {activityState === "error" ? (
          <div className="od-inventory-error">
            <span>Unable to load recent activity</span>
            <button type="button" onClick={() => void refreshActivity()}>
              Retry
            </button>
          </div>
        ) : activityState === "loading" ? (
          <p className="od-inventory-state">Loading recent activity…</p>
        ) : activity.length ? (
          <div className="od-inventory-activity-list">
            {activity.map((entry) => (
              <article key={entry.id}>
                <div>
                  <strong>{entry.itemName}</strong>
                  <span>
                    {movementLabel[entry.movementType]} ·{" "}
                    {time(entry.movementDate)}
                    {entry.reason ? ` · ${entry.reason}` : ""}
                  </span>
                  {entry.staffName && <small>By {entry.staffName}</small>}
                </div>
                <b className={entry.quantityEffect}>
                  {entry.quantityEffect === "in" ? "+" : "−"}
                  {quantity(entry.quantity, entry.unitName)}
                </b>
              </article>
            ))}
          </div>
        ) : (
          <p className="od-inventory-state">No recent inventory activity</p>
        )}
      </section>

      {requestsOpen && (
        <div
          className="od-inventory-request-layer"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setRequestsOpen(false);
              setSelectedRequest(null);
            }
          }}
        >
          <aside
            ref={requestSheetRef}
            className="od-inventory-request-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="owner-inventory-request-title"
            tabIndex={-1}
          >
            <header>
              <div>
                <span>Kitchen requests</span>
                <h2 id="owner-inventory-request-title">
                  {selectedRequest?.itemName ?? "Requests"}
                </h2>
              </div>
              <button
                ref={requestCloseRef}
                type="button"
                aria-label="Close requests"
                onClick={() => {
                  setRequestsOpen(false);
                  setSelectedRequest(null);
                }}
              >
                ×
              </button>
            </header>
            <div className="od-inventory-request-body">
              {selectedRequest ? (
                <RequestDetails request={selectedRequest} />
              ) : requestsState === "ready" ? (
                requests.map((request) => (
                  <button
                    key={request.id}
                    type="button"
                    className="od-inventory-request-row"
                    onClick={() => setSelectedRequest(request)}
                  >
                    <strong>{request.itemName}</strong>
                    <span>
                      {request.stationName ?? "Kitchen"} ·{" "}
                      {quantity(request.quantity, request.unit)} ·{" "}
                      {request.status.replace(/_/g, " ")}
                    </span>
                  </button>
                ))
              ) : (
                <p className="od-inventory-state">Requests unavailable</p>
              )}
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}

function RequestDetails({ request }: { request: InventoryRequest }) {
  return (
    <dl className="od-inventory-request-details">
      <div>
        <dt>Station</dt>
        <dd>{request.stationName ?? "Not recorded"}</dd>
      </div>
      <div>
        <dt>Material</dt>
        <dd>{request.itemName}</dd>
      </div>
      <div>
        <dt>Quantity</dt>
        <dd>{quantity(request.quantity, request.unit)}</dd>
      </div>
      <div>
        <dt>Urgency</dt>
        <dd>{request.urgency}</dd>
      </div>
      <div>
        <dt>Requested by</dt>
        <dd>{request.requesterName ?? "Not recorded"}</dd>
      </div>
      <div>
        <dt>Requested</dt>
        <dd>{time(request.requestedAt)}</dd>
      </div>
      <div>
        <dt>Status</dt>
        <dd>{request.status.replace(/_/g, " ")}</dd>
      </div>
    </dl>
  );
}
