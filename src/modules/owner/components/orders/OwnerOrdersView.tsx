import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Search, SlidersHorizontal, X } from "lucide-react";
import { operationalLabel } from "../../../../core/payment/lifecycle";
import type {
  OwnerOrderFinancialSummary,
  OwnerOrderReadModel,
  OwnerOrderSourceKind,
} from "../../services/ownerOrdersReadModel";

export type OwnerOrdersPrimaryFilter =
  | "all"
  | "active"
  | "payment_due"
  | "served"
  | "closed";

export type OwnerOrdersFilters = {
  search: string;
  primary: OwnerOrdersPrimaryFilter;
  operational: "all" | OwnerOrderReadModel["operationalStatus"];
  source: "all" | OwnerOrderSourceKind;
  payment: "all" | OwnerOrderFinancialSummary;
};

export const OWNER_ORDERS_PRIMARY_FILTERS: Array<{
  value: OwnerOrdersPrimaryFilter;
  desktopLabel: string;
  mobileLabel: string;
}> = [
  { value: "all", desktopLabel: "All", mobileLabel: "All" },
  { value: "active", desktopLabel: "Active", mobileLabel: "Active" },
  {
    value: "payment_due",
    desktopLabel: "Payment Due",
    mobileLabel: "Due",
  },
  { value: "served", desktopLabel: "Served", mobileLabel: "Served" },
  { value: "closed", desktopLabel: "Closed", mobileLabel: "Closed" },
];

const FINANCIAL_LABELS: Record<OwnerOrderFinancialSummary, string> = {
  payment_due: "Payment Due",
  paid: "Paid",
  refunded: "Refunded",
  cancelled: "Cancelled",
  mixed_terminal: "Mixed",
  no_invoice: "No Invoice",
  unknown: "Unknown",
};

export function ownerFinancialLabel(value: OwnerOrderFinancialSummary) {
  return FINANCIAL_LABELS[value];
}

export function ownerOrderSourceLabel(order: OwnerOrderReadModel) {
  if (order.origin.kind === "mixed") return "Mixed sources";
  if (order.origin.kind === "legacy") return "Legacy";
  if (order.origin.kind === "unknown") return "Source unavailable";
  if (order.origin.kind === "customer_qr") return "Customer QR";
  if (order.creator.kind === "single" && order.creator.label) {
    return `${order.origin.label} \u00b7 ${order.creator.label}`;
  }
  if (order.creator.kind === "mixed") {
    return `${order.origin.label} \u00b7 Multiple staff`;
  }
  return order.origin.label;
}

export function formatOwnerOrderTime(
  createdAt: string,
  now = new Date(),
) {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return "Time unavailable";
  const elapsedMinutes = Math.max(
    0,
    Math.floor((now.getTime() - created.getTime()) / 60000),
  );
  if (elapsedMinutes < 1) return "Now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
  if (elapsedMinutes < 24 * 60) return `${Math.floor(elapsedMinutes / 60)}h`;

  const dateKey = (date: Date) =>
    `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const time = new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(created);
  if (dateKey(created) === dateKey(now)) return `Today \u00b7 ${time}`;
  if (dateKey(created) === dateKey(yesterday)) return `Yesterday \u00b7 ${time}`;
  const date = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(created);
  return `${date} \u00b7 ${time}`;
}

export function filterOwnerOrders(
  orders: readonly OwnerOrderReadModel[],
  filters: OwnerOrdersFilters,
) {
  const search = filters.search.trim().toLowerCase();
  return orders.filter((order) => {
    if (filters.primary === "active" && !order.isActive) return false;
    if (
      filters.primary === "payment_due" &&
      !order.financial.hasPaymentDue
    )
      return false;
    if (
      filters.primary === "served" &&
      order.operationalStatus !== "served"
    )
      return false;
    if (
      filters.primary === "closed" &&
      order.operationalStatus !== "closed"
    )
      return false;
    if (
      filters.operational !== "all" &&
      order.operationalStatus !== filters.operational
    )
      return false;
    if (filters.source !== "all" && order.origin.kind !== filters.source)
      return false;
    if (
      filters.payment !== "all" &&
      order.financial.summary !== filters.payment
    )
      return false;
    if (!search) return true;
    return [
      order.displayNumber,
      order.tableNumber,
      order.customerName,
      ownerOrderSourceLabel(order),
      ...order.creator.people.map((person) => person.displayName),
    ].some((value) => value?.toLowerCase().includes(search));
  });
}

export function summarizeOwnerOrders(
  orders: readonly OwnerOrderReadModel[],
) {
  const dueOrders = orders.filter(
    (order) => order.financial.summary === "payment_due",
  );
  return {
    active: orders.filter((order) => order.isActive).length,
    paymentDue: dueOrders.length,
    paymentDueAmount: dueOrders.reduce(
      (sum, order) => sum + order.financial.amountDue,
      0,
    ),
    ready: orders.filter((order) => order.operationalStatus === "ready").length,
    served: orders.filter((order) => order.operationalStatus === "served").length,
  };
}

function operationalTone(status: OwnerOrderReadModel["operationalStatus"]) {
  return `operational-${status}`;
}

function emptyMessage(filters: OwnerOrdersFilters) {
  if (filters.primary === "payment_due") return "No payment-due orders";
  if (filters.primary === "active") return "No active orders";
  if (
    filters.search.trim() ||
    filters.operational !== "all" ||
    filters.source !== "all" ||
    filters.payment !== "all"
  )
    return "No orders match these filters";
  return "No orders yet";
}

function FinancialBadge({
  order,
  available,
}: {
  order: OwnerOrderReadModel;
  available: boolean;
}) {
  if (!available) {
    return <span className="od-order-state financial-unavailable">Unavailable</span>;
  }
  return (
    <span className={`od-order-state financial-${order.financial.summary}`}>
      {ownerFinancialLabel(order.financial.summary)}
    </span>
  );
}

export function OwnerOrderDetails({
  order,
  financialAvailable,
  formatMoney,
  onClose,
}: {
  order: OwnerOrderReadModel;
  financialAvailable: boolean;
  formatMoney: (value: number) => string;
  onClose: () => void;
}) {
  const attribution = order.creator.people;
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);
  return (
    <div
      className="od-order-detail-layer"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={dialogRef}
        className="od-order-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="owner-order-detail-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key !== "Tab") return;
          const focusable = Array.from(
            dialogRef.current?.querySelectorAll<HTMLElement>(
              'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ) ?? [],
          );
          if (focusable.length === 0) {
            event.preventDefault();
            dialogRef.current?.focus();
            return;
          }
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        tabIndex={-1}
      >
        <header>
          <div>
            <span>Order details</span>
            <h2 id="owner-order-detail-title">
              {order.displayNumber ?? "Current order"}
            </h2>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close order details">
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="od-order-detail-body">
          <section>
            <h3>Order</h3>
            <dl>
              <div><dt>Table</dt><dd>{order.tableNumber ? `Table ${order.tableNumber}` : "No table"}</dd></div>
              <div><dt>Customer</dt><dd>{order.customerName || "Guest"}</dd></div>
              <div><dt>Created</dt><dd>{new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(order.createdAt))}</dd></div>
              <div><dt>Items</dt><dd>{order.itemCount}</dd></div>
              <div><dt>Total</dt><dd>{formatMoney(order.total)}</dd></div>
            </dl>
          </section>
          <section>
            <h3>Origin</h3>
            <p>{ownerOrderSourceLabel(order)}</p>
            {attribution.length > 0 &&
              (order.origin.kind === "mixed" || attribution.length > 1) && (
              <ul>
                {attribution.map((person) => (
                  <li key={`${person.source}-${person.staffId ?? person.displayName}`}>
                    {person.source === "waiter" ? "Waiter" : "Cashier"}{" \u00b7 "}{person.displayName}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3>Service</h3>
            <dl>
              <div><dt>Operational status</dt><dd>{operationalLabel(order.operationalStatus)}</dd></div>
              <div><dt>Session</dt><dd>{order.diningSessionStatus ? order.diningSessionStatus.replace(/_/g, " ") : "Unavailable"}</dd></div>
              {order.completedAt && <div><dt>Completed</dt><dd>{formatOwnerOrderTime(order.completedAt)}</dd></div>}
              {order.tableReleasedAt && <div><dt>Table released</dt><dd>{formatOwnerOrderTime(order.tableReleasedAt)}</dd></div>}
            </dl>
          </section>
          <section className={order.isServedPaymentDue ? "payment-due" : ""}>
            <h3>Payment</h3>
            {!financialAvailable ? (
              <p>Financial status unavailable</p>
            ) : (
              <dl>
                <div><dt>Status</dt><dd>{ownerFinancialLabel(order.financial.summary)}</dd></div>
                <div><dt>Amount due</dt><dd>{formatMoney(order.financial.amountDue)}</dd></div>
                <div><dt>Total invoiced</dt><dd>{formatMoney(order.financial.totalInvoiced)}</dd></div>
                <div><dt>Paid amount</dt><dd>{formatMoney(order.financial.paidAmount)}</dd></div>
                {order.financial.refundedAmount > 0 && <div><dt>Refunded</dt><dd>{formatMoney(order.financial.refundedAmount)}</dd></div>}
                {order.financial.cancelledAmount > 0 && <div><dt>Cancelled</dt><dd>{formatMoney(order.financial.cancelledAmount)}</dd></div>}
                <div><dt>Method</dt><dd>{order.financial.paymentMethodSummary ?? "Not recorded"}</dd></div>
                <div><dt>Invoices</dt><dd>{order.financial.invoiceCount}</dd></div>
              </dl>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}

export function OwnerOrdersView({
  orders,
  loading,
  financialAvailable,
  formatMoney,
}: {
  orders: OwnerOrderReadModel[];
  loading: boolean;
  financialAvailable: boolean;
  formatMoney: (value: number) => string;
}) {
  const [search, setSearch] = useState("");
  const [primary, setPrimary] = useState<OwnerOrdersPrimaryFilter>("all");
  const [operational, setOperational] =
    useState<OwnerOrdersFilters["operational"]>("all");
  const [source, setSource] = useState<OwnerOrdersFilters["source"]>("all");
  const [payment, setPayment] =
    useState<OwnerOrdersFilters["payment"]>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const detailTriggerRef = useRef<HTMLElement | null>(null);
  const detailWasOpenRef = useRef(false);
  const filters = { search, primary, operational, source, payment };
  const filtered = useMemo(
    () => filterOwnerOrders(orders, filters),
    [orders, search, primary, operational, source, payment],
  );
  const summary = useMemo(() => summarizeOwnerOrders(orders), [orders]);
  const secondaryFilterCount = [operational, source, payment].filter(
    (value) => value !== "all",
  ).length;
  const selectedOrder = selectedOrderId
    ? orders.find((order) => order.id === selectedOrderId) ?? null
    : null;

  useEffect(() => {
    if (!selectedOrderId) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedOrderId(null);
    };
    const background = Array.from(pageRef.current?.children ?? []).filter(
      (element) => !element.classList.contains("od-order-detail-layer"),
    ) as HTMLElement[];
    const previousAriaHidden = background.map((element) =>
      element.getAttribute("aria-hidden"),
    );
    background.forEach((element) => {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    });
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      background.forEach((element, index) => {
        element.removeAttribute("inert");
        const ariaHidden = previousAriaHidden[index];
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      });
    };
  }, [selectedOrderId]);

  useEffect(() => {
    if (selectedOrderId) {
      detailWasOpenRef.current = true;
      return;
    }
    if (!detailWasOpenRef.current) return;
    detailWasOpenRef.current = false;
    window.requestAnimationFrame(() => detailTriggerRef.current?.focus());
  }, [selectedOrderId]);

  const openDetails = (order: OwnerOrderReadModel, trigger: HTMLElement) => {
    detailTriggerRef.current = trigger;
    setSelectedOrderId(order.id);
  };

  return (
    <div ref={pageRef} className="od-page od-orders-experience">
      <section className="od-orders-summary" aria-label="Order summary">
        <div><span>Active</span><strong>{loading ? "\u2014" : summary.active}</strong></div>
        <div className={financialAvailable && summary.paymentDue > 0 ? "attention" : ""}>
          <span>Payment Due</span>
          {financialAvailable ? (
            <strong>{summary.paymentDue}<small>{" \u00b7 "}{formatMoney(summary.paymentDueAmount)}</small></strong>
          ) : (
            <strong className="unavailable">Unavailable</strong>
          )}
        </div>
        <div><span>Ready</span><strong>{loading ? "\u2014" : summary.ready}</strong></div>
        <div><span>Served</span><strong>{loading ? "\u2014" : summary.served}</strong></div>
      </section>

      <div className="od-orders-toolbar">
        <label className="od-orders-search">
          <Search aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search orders..."
            aria-label="Search orders"
          />
        </label>
        <button
          type="button"
          className={`od-orders-filter-trigger${filtersOpen ? " active" : ""}`}
          aria-expanded={filtersOpen}
          aria-controls="owner-orders-secondary-filters"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <SlidersHorizontal aria-hidden="true" />
          <span>Filters</span>
          {secondaryFilterCount > 0 && <strong>{secondaryFilterCount}</strong>}
        </button>
      </div>

      {filtersOpen && (
        <div id="owner-orders-secondary-filters" className="od-orders-secondary-filters">
          <label>Operational status<select value={operational} onChange={(event) => setOperational(event.target.value as OwnerOrdersFilters["operational"])}><option value="all">All statuses</option><option value="new">New</option><option value="accepted">Accepted</option><option value="preparing">Preparing</option><option value="ready">Ready</option><option value="served">Served</option><option value="closed">Closed</option></select></label>
          <label>Source<select value={source} onChange={(event) => setSource(event.target.value as OwnerOrdersFilters["source"])}><option value="all">All sources</option><option value="customer_qr">Customer QR</option><option value="waiter">Waiter</option><option value="cashier">Cashier</option></select></label>
          <label>Payment<select value={payment} disabled={!financialAvailable} onChange={(event) => setPayment(event.target.value as OwnerOrdersFilters["payment"])}><option value="all">All payment states</option><option value="payment_due">Payment Due</option><option value="paid">Paid</option><option value="refunded">Refunded</option><option value="cancelled">Cancelled</option></select></label>
          <button type="button" onClick={() => { setOperational("all"); setSource("all"); setPayment("all"); }}>Clear filters</button>
        </div>
      )}

      <nav className="od-orders-primary-filters" aria-label="Order views">
        {OWNER_ORDERS_PRIMARY_FILTERS.map((filter) => (
          <button
            type="button"
            key={filter.value}
            className={primary === filter.value ? "active" : ""}
            disabled={filter.value === "payment_due" && !financialAvailable}
            onClick={() => setPrimary(filter.value)}
          >
            <span className="desktop-label">{filter.desktopLabel}</span>
            <span className="mobile-label">{filter.mobileLabel}</span>
          </button>
        ))}
      </nav>

      <section className="od-orders-list" aria-live="polite">
        <div className="od-orders-desktop-table">
          <table>
            <thead><tr><th>Order</th><th>Table</th><th>Source</th><th>Status</th><th>Payment</th><th>Total</th><th>Time</th></tr></thead>
            <tbody>
              {filtered.map((order) => (
                <tr key={order.id} tabIndex={0} onClick={(event) => openDetails(order, event.currentTarget)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openDetails(order, event.currentTarget); } }}>
                  <td><strong>{order.displayNumber ?? "Current order"}</strong><small>{order.itemCount} items</small></td>
                  <td>{order.tableNumber ? `T${order.tableNumber}` : "\u2014"}</td>
                  <td>{ownerOrderSourceLabel(order)}</td>
                  <td><span className={`od-order-state ${operationalTone(order.operationalStatus)}`}>{operationalLabel(order.operationalStatus)}</span></td>
                  <td><FinancialBadge order={order} available={financialAvailable} /></td>
                  <td><strong>{formatMoney(order.total)}</strong></td>
                  <td>{formatOwnerOrderTime(order.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="od-orders-mobile-list">
          {filtered.map((order) => (
            <button type="button" className={`od-orders-mobile-row${order.isServedPaymentDue ? " served-payment-due" : ""}`} key={order.id} onClick={(event) => openDetails(order, event.currentTarget)}>
              <span className="od-orders-mobile-top"><strong>{order.displayNumber ?? "Current order"}</strong><b>{formatMoney(order.total)}</b></span>
              <span className="od-orders-mobile-table">{order.tableNumber ? `Table ${order.tableNumber}` : "No table"}</span>
              <span className="od-orders-mobile-source">{ownerOrderSourceLabel(order)}</span>
              <span className="od-orders-mobile-meta">{order.itemCount} items{" \u00b7 "}{formatOwnerOrderTime(order.createdAt)}</span>
              <span className="od-orders-mobile-states"><span className={`od-order-state ${operationalTone(order.operationalStatus)}`}>{operationalLabel(order.operationalStatus)}</span><FinancialBadge order={order} available={financialAvailable} /><ChevronRight aria-hidden="true" /></span>
            </button>
          ))}
        </div>

        {!loading && filtered.length === 0 && (
          <div className="od-orders-empty">{emptyMessage(filters)}</div>
        )}
        {loading && <div className="od-orders-empty">Loading orders...</div>}
      </section>

      {selectedOrder && (
        <OwnerOrderDetails
          order={selectedOrder}
          financialAvailable={financialAvailable}
          formatMoney={formatMoney}
          onClose={() => setSelectedOrderId(null)}
        />
      )}
    </div>
  );
}
