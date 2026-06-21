import { useEffect, useMemo, useState } from "react";
import {
  fetchKitchenOrders,
  fetchKitchenRestaurant,
  markOrderReady,
  startOrderPreparation,
} from "../services/kitchenOrderService";
import type { KitchenOrder, KitchenOrderStatus, KitchenRestaurant } from "../types";

function formatMoney(value: number) {
  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ETB`;
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "Not recorded";
  }

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

type KitchenOrderSectionProps = {
  title: string;
  emptyMessage: string;
  orders: KitchenOrder[];
  actionOrderId: string | null;
  actionLabel?: string;
  busyLabel?: string;
  timestampLabel: string;
  getTimestamp: (order: KitchenOrder) => string | null;
  onAction?: (orderId: string) => void;
};

function KitchenOrderSection({
  title,
  emptyMessage,
  orders,
  actionOrderId,
  actionLabel,
  busyLabel,
  timestampLabel,
  getTimestamp,
  onAction,
}: KitchenOrderSectionProps) {
  return (
    <section className="kitchen-section" aria-labelledby={`${title.replace(/\s+/g, "-")}-heading`}>
      <div className="kitchen-section-heading">
        <h2 id={`${title.replace(/\s+/g, "-")}-heading`}>{title}</h2>
        <span>{orders.length}</span>
      </div>

      {orders.length === 0 ? (
        <p className="kitchen-empty">{emptyMessage}</p>
      ) : (
        <div className="kitchen-order-list">
          {orders.map((order) => {
            const isBusy = actionOrderId === order.id;

            return (
              <article className="kitchen-order" key={order.id}>
                <div className="kitchen-order-topline">
                  <div>
                    <h3>{formatOrderNumber(order.id)}</h3>
                    <p>Created {formatDateTime(order.createdAt)}</p>
                  </div>
                  <strong>{formatMoney(order.totalPrice)}</strong>
                </div>

                <dl className="kitchen-order-details">
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
                  <div>
                    <dt>{timestampLabel}</dt>
                    <dd>{formatDateTime(getTimestamp(order))}</dd>
                  </div>
                </dl>

                <div className="kitchen-order-items">
                  {order.items.length === 0 ? (
                    <p>Items are unavailable for this order.</p>
                  ) : (
                    order.items.map((item) => (
                      <div className="kitchen-order-item" key={item.id}>
                        <div>
                          <strong>{item.name}</strong>
                          <span>Qty {item.quantity}</span>
                        </div>
                        <span>{formatMoney(item.price * item.quantity)}</span>
                      </div>
                    ))
                  )}
                </div>

                {onAction && actionLabel ? (
                  <div className="kitchen-order-actions">
                    <button type="button" disabled={isBusy} onClick={() => onAction(order.id)}>
                      {isBusy ? busyLabel ?? "Working..." : actionLabel}
                    </button>
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

type KitchenDashboardPageProps = {
  restaurantId: string;
  restaurant: KitchenRestaurant;
};

export function KitchenDashboardPage({ restaurantId, restaurant: initialRestaurant }: KitchenDashboardPageProps) {
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [restaurant, setRestaurant] = useState<KitchenRestaurant | null>(initialRestaurant);
  const [actionOrderId, setActionOrderId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadOrders() {
      try {
        setIsLoading(true);
        setError(null);
        const [fetchedRestaurant, fetchedOrders] = await Promise.all([
          fetchKitchenRestaurant(restaurantId),
          fetchKitchenOrders(restaurantId),
        ]);

        if (isMounted) {
          setRestaurant(fetchedRestaurant);
          setOrders(fetchedOrders);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : "Kitchen orders could not be loaded.");
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
  }, [restaurantId]);

  const ordersByStatus = useMemo(() => {
    const grouped: Record<KitchenOrderStatus, KitchenOrder[]> = {
      paid: [],
      preparing: [],
      ready: [],
    };

    for (const order of orders) {
      grouped[order.status].push(order);
    }

    return grouped;
  }, [orders]);

  function mergeUpdatedOrder(updatedOrder: KitchenOrder) {
    setOrders((currentOrders) =>
      currentOrders.map((order) =>
        order.id === updatedOrder.id
          ? {
              ...order,
              ...updatedOrder,
              items: order.items,
            }
          : order
      )
    );
  }

  async function handleStartPreparation(orderId: string) {
    try {
      setActionOrderId(orderId);
      setError(null);
      const updatedOrder = await startOrderPreparation(orderId);
      mergeUpdatedOrder(updatedOrder);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Order preparation could not be started.");
    } finally {
      setActionOrderId(null);
    }
  }

  async function handleMarkReady(orderId: string) {
    try {
      setActionOrderId(orderId);
      setError(null);
      const updatedOrder = await markOrderReady(orderId);
      mergeUpdatedOrder(updatedOrder);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Order could not be marked ready.");
    } finally {
      setActionOrderId(null);
    }
  }

  return (
    <main className="kitchen-page">
      <header className="kitchen-header">
        <div className="kitchen-brand">
          <div className="kitchen-logo" aria-hidden="true">
            {restaurant ? getRestaurantInitial(restaurant.name) : "S"}
          </div>
          <div>
            <p className="kitchen-restaurant-name">{restaurant?.name || "Restaurant"}</p>
            <h1>Kitchen Dashboard</h1>
          </div>
        </div>
        <button type="button" onClick={() => window.location.reload()}>
          Refresh
        </button>
      </header>

      {error ? <p className="kitchen-alert">{error}</p> : null}

      {isLoading ? (
        <section className="kitchen-loading">
          <p>Loading kitchen orders...</p>
        </section>
      ) : (
        <div className="kitchen-layout">
          <KitchenOrderSection
            title="Paid"
            emptyMessage="No paid orders waiting."
            orders={ordersByStatus.paid}
            actionOrderId={actionOrderId}
            actionLabel="Start Preparing"
            busyLabel="Starting..."
            timestampLabel="Paid"
            getTimestamp={(order) => order.paymentVerifiedAt}
            onAction={handleStartPreparation}
          />

          <KitchenOrderSection
            title="Preparing"
            emptyMessage="No orders in preparation."
            orders={ordersByStatus.preparing}
            actionOrderId={actionOrderId}
            actionLabel="Mark Ready"
            busyLabel="Marking..."
            timestampLabel="Started"
            getTimestamp={(order) => order.preparationStartedAt}
            onAction={handleMarkReady}
          />

          <KitchenOrderSection
            title="Ready"
            emptyMessage="No ready orders."
            orders={ordersByStatus.ready}
            actionOrderId={actionOrderId}
            timestampLabel="Ready"
            getTimestamp={(order) => order.readyMarkedAt}
          />
        </div>
      )}
    </main>
  );
}
