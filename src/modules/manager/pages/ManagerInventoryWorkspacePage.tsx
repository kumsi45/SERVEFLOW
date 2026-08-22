import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  PackageSearch,
  X,
} from "lucide-react";
import { useTenantRealtime } from "../../../core/realtime/useTenantRealtime";
import type {
  InventoryRequest,
  InventoryRequestStatus,
} from "../../kitchen/services/inventoryRequestService";
import {
  loadManagerInventoryWorkspace,
  type ManagerInventorySnapshot,
  type ManagerStockItem,
} from "../services/managerInventoryWorkspaceService";
import "../styles/managerInventoryWorkspace.css";

type Props = {
  restaurantId: string;
  restaurantName: string;
  managerName: string;
};
type RequestFilter = "pending" | "accepted" | "delivered" | "rejected";
type StockFilter = "all" | ManagerStockItem["status"];

const requestFilters: Array<{ id: RequestFilter; label: string }> = [
  { id: "pending", label: "Pending" },
  { id: "accepted", label: "Approved / Waiting Fulfillment" },
  { id: "delivered", label: "Completed" },
  { id: "rejected", label: "Rejected" },
];

export function ManagerInventoryWorkspacePage({ restaurantId }: Props) {
  const [snapshot, setSnapshot] = useState<ManagerInventorySnapshot | null>(
    null,
  );
  const [requestFilter, setRequestFilter] = useState<RequestFilter>("pending");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedRequest, setSelectedRequest] =
    useState<InventoryRequest | null>(null);
  const [selectedStock, setSelectedStock] = useState<ManagerStockItem | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await loadManagerInventoryWorkspace(restaurantId));
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load inventory workspace.",
      );
    }
  }, [restaurantId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useTenantRealtime({
    channelName: "manager-inventory-workspace",
    restaurantId,
    tables: [
      "inventory_items",
      "inventory_movements",
      "kitchen_inventory_requests",
      "menu_items",
      "recipe_ingredients",
    ],
    refresh,
  });

  const stock = snapshot?.stock ?? [];
  const requests = snapshot?.requests ?? [];
  const counts = useMemo(
    () => ({
      critical: stock.filter((item) => item.status === "critical").length,
      low: stock.filter((item) => item.status === "low").length,
      out: stock.filter((item) => item.status === "out").length,
      pending: requests.filter((item) => item.status === "pending").length,
      fulfillment: requests.filter((item) => item.status === "accepted").length,
    }),
    [requests, stock],
  );
  const visibleRequests = requests.filter(
    (request) => request.status === requestFilter,
  );
  const visibleStock = stock.filter((item) => {
    if (stockFilter !== "all" && item.status !== stockFilter) return false;
    const needle = query.trim().toLowerCase();
    return (
      !needle ||
      `${item.name} ${item.category} ${item.storage} ${item.affectedMenuItems.join(" ")}`
        .toLowerCase()
        .includes(needle)
    );
  });
  const stockAttention = (status: ManagerStockItem["status"]) =>
    stock
      .filter((item) => item.status === status)
      .map((item) => ({
        key: item.id,
        tone:
          status === "out" || status === "critical" ? "critical" : "warning",
        title:
          status === "out"
            ? `${item.name} is out of stock`
            : `${item.name} is ${status} stock`,
        detail: `${formatQuantity(item.current)} ${item.unit} available · minimum ${formatQuantity(item.minimum)}${item.affectedMenuItems.length ? ` · affects ${item.affectedMenuItems.slice(0, 2).join(", ")}` : ""}`,
        action: () => setSelectedStock(item),
      }));
  const requestAttention = (status: "pending" | "accepted") =>
    requests
      .filter((item) => item.status === status)
      .map((request) => ({
        key: request.id,
        tone: request.urgency === "critical" ? "critical" : "warning",
        title:
          status === "pending"
            ? `${request.itemName} request needs review`
            : `${request.itemName} is waiting for fulfillment`,
        detail: `${request.quantity} ${request.unit} · ${request.stationName ?? "Requesting department"} · ${age(request.requestedAt)}`,
        action: () => setSelectedRequest(request),
      }));
  const attention = [
    ...stockAttention("critical"),
    ...stockAttention("out"),
    ...requestAttention("pending"),
    ...requestAttention("accepted"),
    ...stockAttention("low"),
  ];
  const preparation = stock
    .filter(
      (item) =>
        item.status !== "healthy" ||
        ((item.usage?.weeklyConsumption ?? 0) > 0 &&
          item.usage?.supplierReminder),
    )
    .slice(0, 6);
  const usageExceptions = stock.filter(
    (item) =>
      item.usage &&
      (item.usage.movement === "fast" || item.usage.supplierReminder),
  );

  function openFullInventory() {
    window.sessionStorage.setItem(
      "serveflow.active-restaurant:inventory",
      restaurantId,
    );
    window.history.pushState({}, "", "/inventory/dashboard");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  return (
    <main className="miw-page">
      <header className="miw-header">
        <div>
          <h1>Inventory</h1>
          <p>
            Monitor stock health, approve operational requests, and prepare for
            upcoming service.
          </p>
        </div>
        <button type="button" onClick={openFullInventory}>
          Open Full Inventory <ExternalLink size={16} />
        </button>
      </header>
      {error && (
        <div className="miw-message error" role="alert">
          {error}
        </div>
      )}

      <section className="miw-metrics" aria-label="Inventory summary">
        <button onClick={() => setStockFilter("critical")}>
          <span>Critical Stock</span>
          <strong>{counts.critical}</strong>
        </button>
        <button onClick={() => setStockFilter("low")}>
          <span>Low Stock</span>
          <strong>{counts.low}</strong>
        </button>
        <button onClick={() => setStockFilter("out")}>
          <span>Out of Stock</span>
          <strong>{counts.out}</strong>
        </button>
        <button onClick={() => setRequestFilter("pending")}>
          <span>Pending Requests</span>
          <strong>{counts.pending}</strong>
        </button>
        <button onClick={() => setRequestFilter("accepted")}>
          <span>Waiting Fulfillment</span>
          <strong>{counts.fulfillment}</strong>
        </button>
      </section>

      <section className="miw-panel miw-attention">
        <header>
          <div>
            <span>Exceptions</span>
            <h2>Needs Attention</h2>
          </div>
          <b>{attention.length}</b>
        </header>
        {attention.length ? (
          <div className="miw-attention-list">
            {attention.slice(0, 8).map((item) => (
              <button type="button" key={item.key} onClick={item.action}>
                <i className={item.tone} />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
                <ArrowRight size={17} />
              </button>
            ))}
          </div>
        ) : (
          <div className="miw-healthy">
            <CheckCircle2 size={18} /> Inventory is operating normally — no
            manager attention required.
          </div>
        )}
      </section>

      <section className="miw-panel">
        <header>
          <div>
            <span>Operational requests</span>
            <h2>Request Center</h2>
          </div>
        </header>
        <div className="miw-chips" role="tablist">
          {requestFilters.map((filter) => (
            <button
              type="button"
              role="tab"
              aria-selected={requestFilter === filter.id}
              className={requestFilter === filter.id ? "active" : ""}
              key={filter.id}
              onClick={() => setRequestFilter(filter.id)}
            >
              {filter.label}{" "}
              <b>
                {requests.filter((item) => item.status === filter.id).length}
              </b>
            </button>
          ))}
        </div>
        <div className="miw-list requests">
          <div className="miw-row head">
            <span>Item</span>
            <span>Department</span>
            <span>Requested by</span>
            <span>Age</span>
            <span>Current stock</span>
            <span>Priority</span>
            <span>Status</span>
            <span>Action</span>
          </div>
          {visibleRequests.map((request) => {
            const currentStock = stock.find(
              (item) => item.id === request.inventoryItemId,
            );
            return (
              <button
                type="button"
                className="miw-row"
                key={request.id}
                onClick={() => setSelectedRequest(request)}
              >
                <span data-label="Item">
                  <strong>{request.itemName}</strong>
                  <small>
                    {formatQuantity(request.quantity)} {request.unit}
                    {request.comment ? ` · ${request.comment}` : ""}
                  </small>
                </span>
                <span data-label="Department">
                  {request.stationName ?? "Not recorded"}
                </span>
                <span data-label="Requested by">
                  {request.requesterName ?? "Not recorded"}
                </span>
                <span data-label="Age">{age(request.requestedAt)}</span>
                <span data-label="Current stock">
                  {currentStock
                    ? `${formatQuantity(currentStock.current)} ${currentStock.unit}`
                    : "Not linked"}
                </span>
                <span
                  data-label="Priority"
                  className={`miw-badge ${request.urgency}`}
                >
                  {title(request.urgency)}
                </span>
                <span
                  data-label="Status"
                  className={`miw-badge ${request.status}`}
                >
                  {requestStatus(request.status)}
                </span>
                <span className="miw-link">
                  Review <ArrowRight size={15} />
                </span>
              </button>
            );
          })}
          {!visibleRequests.length && (
            <div className="miw-empty">
              No{" "}
              {requestFilters
                .find((item) => item.id === requestFilter)
                ?.label.toLowerCase()}{" "}
              requests.
            </div>
          )}
        </div>
      </section>

      <section className="miw-panel">
        <header className="miw-toolbar">
          <div>
            <span>Current ledger balance</span>
            <h2>Stock Health</h2>
          </div>
          <div>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search stock items..."
              aria-label="Search stock items"
            />
            <select
              value={stockFilter}
              onChange={(event) =>
                setStockFilter(event.target.value as StockFilter)
              }
              aria-label="Filter stock status"
            >
              <option value="all">All stock</option>
              <option value="out">Out of stock</option>
              <option value="critical">Critical</option>
              <option value="low">Low</option>
              <option value="healthy">Healthy</option>
            </select>
          </div>
        </header>
        <div className="miw-list stock">
          <div className="miw-row head">
            <span>Item</span>
            <span>Category</span>
            <span>Current</span>
            <span>Unit</span>
            <span>Status</span>
            <span>Affected area</span>
            <span>Action</span>
          </div>
          {visibleStock.map((item) => (
            <button
              type="button"
              className="miw-row"
              key={item.id}
              onClick={() => setSelectedStock(item)}
            >
              <span data-label="Item">
                <strong>{item.name}</strong>
                <small>{item.storage}</small>
              </span>
              <span data-label="Category">{item.category}</span>
              <strong data-label="Current">
                {formatQuantity(item.current)}
              </strong>
              <span data-label="Unit">{item.unit}</span>
              <span data-label="Status" className={`miw-badge ${item.status}`}>
                {stockLabel(item.status)}
              </span>
              <span data-label="Affected area">
                {item.affectedMenuItems.length
                  ? item.affectedMenuItems.slice(0, 2).join(", ")
                  : "No menu link"}
              </span>
              <span className="miw-link">
                View <ArrowRight size={15} />
              </span>
            </button>
          ))}
          {!visibleStock.length && (
            <div className="miw-empty">No stock items match this view.</div>
          )}
        </div>
      </section>

      <section className="miw-panel">
        <header>
          <div>
            <span>Threshold and recent usage signals</span>
            <h2>Prepare for Next Service</h2>
          </div>
        </header>
        {preparation.length ? (
          <div className="miw-prepare">
            {preparation.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => setSelectedStock(item)}
              >
                <PackageSearch size={18} />
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {formatQuantity(item.current)} {item.unit} available ·
                    minimum {formatQuantity(item.minimum)} · threshold gap{" "}
                    {formatQuantity(Math.max(0, item.minimum - item.current))}
                    {item.usage?.weeklyConsumption
                      ? ` · ${formatQuantity(item.usage.weeklyConsumption)} used in supported 7-day history`
                      : ""}
                  </small>
                </span>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
        ) : (
          <div className="miw-healthy">
            <CheckCircle2 size={18} /> No threshold or supported recent-usage
            exception requires preparation.
          </div>
        )}
      </section>

      {usageExceptions.length > 0 && (
        <section className="miw-panel">
          <header>
            <div>
              <span>Supported request-history signals</span>
              <h2>Usage &amp; Stock Exceptions</h2>
            </div>
          </header>
          <div className="miw-prepare">
            {usageExceptions.slice(0, 6).map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => setSelectedStock(item)}
              >
                <PackageSearch size={18} />
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {item.usage?.movement === "fast"
                      ? "Fast-moving relative to other items in fulfilled request history"
                      : "Supplier lead-time reminder"}{" "}
                    · {formatQuantity(item.usage?.weeklyConsumption ?? 0)}{" "}
                    {item.unit} in supported 7-day history
                  </small>
                </span>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
        </section>
      )}

      {selectedRequest && (
        <RequestDrawer
          request={selectedRequest}
          stock={stock.find(
            (item) => item.id === selectedRequest.inventoryItemId,
          )}
          onClose={() => setSelectedRequest(null)}
          onOpenInventory={openFullInventory}
        />
      )}
      {selectedStock && (
        <StockDrawer
          item={selectedStock}
          onClose={() => setSelectedStock(null)}
          onOpenInventory={openFullInventory}
        />
      )}
    </main>
  );
}

function RequestDrawer({
  request,
  stock,
  onClose,
  onOpenInventory,
}: {
  request: InventoryRequest;
  stock?: ManagerStockItem;
  onClose: () => void;
  onOpenInventory: () => void;
}) {
  return (
    <div
      className="miw-drawer-layer"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <aside
        className="miw-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Inventory request review"
      >
        <header>
          <div>
            <span>Request review</span>
            <h2>{request.itemName}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </header>
        <div className="miw-drawer-body">
          <dl>
            <div>
              <dt>Quantity</dt>
              <dd>
                {formatQuantity(request.quantity)} {request.unit}
              </dd>
            </div>
            <div>
              <dt>Department</dt>
              <dd>{request.stationName ?? "Not recorded"}</dd>
            </div>
            <div>
              <dt>Requested by</dt>
              <dd>{request.requesterName ?? "Not recorded"}</dd>
            </div>
            <div>
              <dt>Priority</dt>
              <dd>{title(request.urgency)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{requestStatus(request.status)}</dd>
            </div>
            <div>
              <dt>Current stock</dt>
              <dd>
                {stock
                  ? `${formatQuantity(stock.current)} ${stock.unit}`
                  : "Not linked"}
              </dd>
            </div>
          </dl>
          {request.comment && (
            <div className="miw-note">
              <strong>Request note</strong>
              <p>{request.comment}</p>
            </div>
          )}
          {request.rejectionReason && (
            <div className="miw-note">
              <strong>Rejection reason</strong>
              <p>{request.rejectionReason}</p>
            </div>
          )}
          {request.status === "pending" && (
            <div className="miw-contract-note">
              <strong>Pending Manager review.</strong>
              <p>Approve or reject this request from Live Operations. Inventory fulfillment begins only after approval.</p>
            </div>
          )}
        </div>
        <footer>
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button type="button" className="primary" onClick={onOpenInventory}>
            Open Full Inventory
          </button>
        </footer>
      </aside>
    </div>
  );
}
function StockDrawer({
  item,
  onClose,
  onOpenInventory,
}: {
  item: ManagerStockItem;
  onClose: () => void;
  onOpenInventory: () => void;
}) {
  return (
    <div
      className="miw-drawer-layer"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <aside
        className="miw-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Stock item details"
      >
        <header>
          <div>
            <span>Stock context</span>
            <h2>{item.name}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </header>
        <div className="miw-drawer-body">
          <dl>
            <div>
              <dt>Current balance</dt>
              <dd>
                {formatQuantity(item.current)} {item.unit}
              </dd>
            </div>
            <div>
              <dt>Minimum threshold</dt>
              <dd>
                {formatQuantity(item.minimum)} {item.unit}
              </dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{stockLabel(item.status)}</dd>
            </div>
            <div>
              <dt>Category</dt>
              <dd>{item.category}</dd>
            </div>
            <div>
              <dt>Storage</dt>
              <dd>{item.storage}</dd>
            </div>
            <div>
              <dt>7-day supported usage</dt>
              <dd>
                {item.usage
                  ? `${formatQuantity(item.usage.weeklyConsumption)} ${item.unit}`
                  : "Unavailable"}
              </dd>
            </div>
          </dl>
          <div className="miw-note">
            <strong>Affected menu items</strong>
            <p>
              {item.affectedMenuItems.length
                ? item.affectedMenuItems.join(", ")
                : "No supported menu or recipe link."}
            </p>
          </div>
        </div>
        <footer>
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button type="button" className="primary" onClick={onOpenInventory}>
            Open Full Inventory
          </button>
        </footer>
      </aside>
    </div>
  );
}

function age(value: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 60000),
  );
  return minutes < 60
    ? `${minutes}m`
    : minutes < 1440
      ? `${Math.floor(minutes / 60)}h`
      : `${Math.floor(minutes / 1440)}d`;
}
function formatQuantity(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(
    value,
  );
}
function title(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}
function requestStatus(value: InventoryRequestStatus) {
  return {
    pending: "Pending",
    accepted: "Approved · waiting fulfillment",
    delivered: "Completed",
    rejected: "Rejected",
  }[value];
}
function stockLabel(value: ManagerStockItem["status"]) {
  return {
    out: "Out of stock",
    critical: "Critical",
    low: "Low",
    healthy: "Healthy",
  }[value];
}
