import { useEffect, useMemo, useState } from "react";
import {
  approveOrderPayment,
  fetchCashierOrders,
  fetchCashierRestaurant,
} from "../services/cashierOrderService";
import { signOutStaff } from "../../staff-auth/services/staffAuthService";
import type { CashierOrder, CashierRestaurant } from "../types";

function formatMoney(value: number) {
  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ETB`;
}

function formatCreatedTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatOrderNumber(orderId: string) {
  return `#${orderId.slice(0, 8).toUpperCase()}`;
}

function getRestaurantInitial(restaurantName: string) {
  return restaurantName.trim().charAt(0).toUpperCase() || "S";
}

type OrderSectionProps = {
  title: string;
  emptyMessage: string;
  orders: CashierOrder[];
  expandedOrderIds: Set<string>;
  approvingOrderId: string | null;
  onToggleItems: (orderId: string) => void;
  onApprovePayment?: (orderId: string) => void;
};

function OrderSection({
  title,
  emptyMessage,
  orders,
  expandedOrderIds,
  approvingOrderId,
  onToggleItems,
  onApprovePayment,
}: OrderSectionProps) {
  return (
    <section className="cashier-section" aria-labelledby={`${title.replace(/\s+/g, "-")}-heading`}>
      <div className="cashier-section-heading">
        <h2 id={`${title.replace(/\s+/g, "-")}-heading`}>{title}</h2>
        <span>{orders.length}</span>
      </div>

      {orders.length === 0 ? (
        <p className="cashier-empty">{emptyMessage}</p>
      ) : (
        <div className="cashier-order-list">
          {orders.map((order) => {
            const itemsAreVisible = expandedOrderIds.has(order.id);
            const isApproving = approvingOrderId === order.id;

            return (
              <article className="cashier-order" key={order.id}>
                <div className="cashier-order-topline">
                  <div>
                    <h3>{formatOrderNumber(order.id)}</h3>
                    <p>Created {formatCreatedTime(order.createdAt)}</p>
                  </div>
                  <strong>{formatMoney(order.totalPrice)}</strong>
                </div>

                <dl className="cashier-order-details">
                  <div>
                    <dt>Customer</dt>
                    <dd>{order.customerName || "Guest"}</dd>
                  </div>
                  <div>
                    <dt>Table</dt>
                    <dd>{order.tableNumber || "Not provided"}</dd>
                  </div>
                  <div>
                    <dt>Payment</dt>
                    <dd>{order.paymentMethod || "Not provided"}</dd>
                  </div>
                </dl>

                <div className="cashier-order-actions">
                  <button type="button" onClick={() => onToggleItems(order.id)}>
                    {itemsAreVisible ? "Hide Items" : "View Items"}
                  </button>

                  {onApprovePayment ? (
                    <button type="button" disabled={isApproving} onClick={() => onApprovePayment(order.id)}>
                      {isApproving ? "Approving..." : "Approve Payment"}
                    </button>
                  ) : null}
                </div>

                {itemsAreVisible ? (
                  <div className="cashier-order-items">
                    {order.items.length === 0 ? (
                      <p>Items are unavailable for this order.</p>
                    ) : (
                      order.items.map((item) => (
                        <div className="cashier-order-item" key={item.id}>
                          <div>
                            <strong>{item.name}</strong>
                            <span>Qty {item.quantity}</span>
                          </div>
                          <span>{formatMoney(item.price * item.quantity)}</span>
                        </div>
                      ))
                    )}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

type CashierDashboardPageProps = {
  restaurant: CashierRestaurant;
};

export function CashierDashboardPage({ restaurant: selectedRestaurant }: CashierDashboardPageProps) {
  const [orders, setOrders] = useState<CashierOrder[]>([]);
  const [restaurant, setRestaurant] = useState<CashierRestaurant | null>(selectedRestaurant);
  const [expandedOrderIds, setExpandedOrderIds] = useState<Set<string>>(() => new Set());
  const [approvingOrderId, setApprovingOrderId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadOrders() {
      try {
        setIsLoading(true);
        setError(null);
        const [fetchedRestaurant, fetchedOrders] = await Promise.all([
          fetchCashierRestaurant(selectedRestaurant.id),
          fetchCashierOrders(selectedRestaurant.id),
        ]);

        if (isMounted) {
          setRestaurant(fetchedRestaurant);
          setOrders(fetchedOrders);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : "Cashier orders could not be loaded.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadOrders();

    return () => {
      isMounted = false;
    };
  }, [selectedRestaurant.id]);

  const pendingOrders = useMemo(
    () => orders.filter((order) => order.status === "pending_payment"),
    [orders]
  );
  const paidOrders = useMemo(() => orders.filter((order) => order.status === "paid"), [orders]);

  function toggleItems(orderId: string) {
    setExpandedOrderIds((current) => {
      const next = new Set(current);

      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }

      return next;
    });
  }

  async function handleApprovePayment(orderId: string) {
    const existingOrder = orders.find((order) => order.id === orderId);

    if (!existingOrder) {
      return;
    }

    try {
      setApprovingOrderId(orderId);
      setError(null);
      const approvedOrder = await approveOrderPayment(orderId);

      setOrders((currentOrders) =>
        currentOrders.map((order) =>
          order.id === orderId
            ? {
                ...order,
                status: approvedOrder.status,
                paymentVerifiedAt: approvedOrder.paymentVerifiedAt,
              }
            : order
        )
      );
    } catch (approvalError) {
      setError(
        approvalError instanceof Error ? approvalError.message : "Payment could not be approved."
      );
    } finally {
      setApprovingOrderId(null);
    }
  }

  async function handleSignOut() {
    try {
      await signOutStaff();
    } finally {
      window.location.replace("/staff-login");
    }
  }

  return (
    <main className="cashier-page">
      <header className="cashier-header">
        <div className="cashier-brand">
          <div className="cashier-logo" aria-hidden="true">
            {restaurant?.logoUrl ? (
              <img src={restaurant.logoUrl} alt="" />
            ) : (
              <span>{restaurant ? getRestaurantInitial(restaurant.name) : "S"}</span>
            )}
          </div>
          <div>
            <p className="cashier-restaurant-name">{restaurant?.name || "Restaurant"}</p>
            <h1>Cashier Dashboard</h1>
          </div>
        </div>
        <div className="cashier-header-actions">
          <button type="button" onClick={() => window.location.reload()}>
            Refresh
          </button>
          <button type="button" onClick={handleSignOut}>
            Sign Out
          </button>
        </div>
      </header>

      {error ? <p className="cashier-alert">{error}</p> : null}

      {isLoading ? (
        <section className="cashier-loading">
          <p>Loading cashier orders...</p>
        </section>
      ) : (
        <div className="cashier-layout">
          <OrderSection
            title="Pending Payment"
            emptyMessage="No pending payment orders."
            orders={pendingOrders}
            expandedOrderIds={expandedOrderIds}
            approvingOrderId={approvingOrderId}
            onToggleItems={toggleItems}
            onApprovePayment={handleApprovePayment}
          />

          <OrderSection
            title="Paid Orders"
            emptyMessage="No paid orders yet."
            orders={paidOrders}
            expandedOrderIds={expandedOrderIds}
            approvingOrderId={approvingOrderId}
            onToggleItems={toggleItems}
          />
        </div>
      )}
    </main>
  );
}
