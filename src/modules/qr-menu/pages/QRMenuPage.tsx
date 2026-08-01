import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_MENU_LANGUAGE,
  MENU_LANGUAGE_OPTIONS,
  isMenuLanguage,
  type MenuLanguage,
} from "../../../core/menu/menuLanguage";
import { subscribeCustomerTrackingEvents } from "../../../core/realtime/restaurantEventService";
import {
  canonicalOperationalStatus,
  canonicalPaymentStatus,
  customerTrackingEta,
  customerTrackingMessage,
  customerTrackingStep,
  operationalLabel,
  paymentLabel,
} from "../../../core/payment/lifecycle";
import { CanonicalLifecycleStatus } from "../../../core/payment/LifecycleBadge";
import type { RealtimeConnectionState } from "../../../core/realtime/realtimeNotifications";
import { ThemeProvider } from "../../menu/theme-engine/ThemeProvider";
import { ThemeRenderer } from "../../menu/theme-engine/ThemeRenderer";
import { resolveMenuTheme } from "../../menu/theme-engine/ThemeTypes";
import { ModernFoodView } from "../../menu/theme-engine/themes/modern/ModernFoodView";
import { ModernOrdersView } from "../../menu/theme-engine/themes/modern/ModernOrdersView";
import { useModernMenuNavigation } from "../../menu/theme-engine/themes/modern/useModernMenuNavigation";
import { FoodInfoPanel } from "../components/FoodInfoPanel";
import {
  formatMenuPrice,
  setMenuCurrency,
} from "../components/menuPresentation";
import { useQRMenu } from "../hooks/useQRMenu";
import { logPublicQrScan } from "../services/qrMenuService";
import { PublicQrCheckoutPanel } from "../../public-qr-ordering/components/PublicQrCheckoutPanel";
import { PublicQrCartPanel } from "../../public-qr-ordering/components/PublicQrCartPanel";
import { usePublicQrCart } from "../../public-qr-ordering/hooks/usePublicQrCart";
import { usePublicQrCheckoutState } from "../../public-qr-ordering/hooks/usePublicQrCheckoutState";
import {
  fetchPublicQrOrderSession,
  fetchPublicPaymentRuntime,
  submitPublicOrderFeedback,
  submitPublicQrOrder,
  uploadPublicOrderFeedbackPhoto,
} from "../../public-qr-ordering/services/publicQrOrderService";
import {
  buildPublicQrSession,
  logPublicQrContext,
} from "../../public-qr-ordering/services/publicQrContext";
import {
  persistCustomerTracking,
  readCustomerTracking,
} from "../../public-qr-ordering/services/customerTrackingService";
import { isPaymentMethod } from "../../public-qr-ordering/types";
import type {
  PublicQrOrderInvoice,
  PublicQrOrderSession,
  SubmittedPublicQrOrder,
} from "../../public-qr-ordering/types";
import type { MenuItem } from "../types";
import { publishedMenuImageInput } from "../../../core/presentation/menuItemImage";
import { useSmartImagePrefetch } from "../../../core/presentation/useSmartImagePrefetch";
import type { PublicPaymentRuntime } from "../../../core/printing-payment/runtime";

type QRMenuPageProps = {
  restaurantSlug: string;
};

type ServedFeedbackOrder = {
  orderId: string;
  orderLabel: string;
  restaurantId: string;
  tableNumber: string;
  qrToken: string;
  sessionKey: string;
  invoiceNumber: number;
  total: number;
  items: PublicQrOrderSession["items"];
};

function getLatestInvoice(invoices: PublicQrOrderInvoice[]) {
  return invoices.reduce<PublicQrOrderInvoice | null>((latest, invoice) => {
    if (!latest || invoice.invoice_number > latest.invoice_number) {
      return invoice;
    }
    return latest;
  }, null);
}

function getCustomerTrackingStatus(
  orderStatus?: string,
  invoiceStatus?: string | null,
) {
  void invoiceStatus;
  return canonicalOperationalStatus(orderStatus);
}

function formatStatusLabel(status?: string) {
  return operationalLabel(status);
}

function getReadableOrderNumber(
  orderId?: string,
  displayNumber?: string | null,
  diningSessionDisplayNumber?: string | null,
) {
  if (displayNumber) return displayNumber;
  if (diningSessionDisplayNumber) return diningSessionDisplayNumber;
  return orderId ? "Current order" : "--";
}

function getReadableInvoiceNumber(
  invoice?: PublicQrOrderInvoice | null,
  submitted?: SubmittedPublicQrOrder | null,
) {
  return (
    invoice?.display_number ??
    submitted?.invoice_display_number ??
    String(invoice?.invoice_number ?? submitted?.invoice_number ?? 1)
  );
}

export function QRMenuPage({ restaurantSlug }: QRMenuPageProps) {
  const [menuLanguage, setMenuLanguage] = useState<MenuLanguage>(() => {
    try {
      const saved = window.localStorage.getItem("serveflow:menu-language");
      return isMenuLanguage(saved) ? saved : DEFAULT_MENU_LANGUAGE;
    } catch {
      return DEFAULT_MENU_LANGUAGE;
    }
  });
  const modernNavigation = useModernMenuNavigation();
  const checkout = usePublicQrCheckoutState(restaurantSlug);
  const cart = usePublicQrCart(restaurantSlug, checkout.sessionKey);
  const [submitError, setSubmitError] = useState<string>();
  const [paymentRuntime, setPaymentRuntime] = useState<PublicPaymentRuntime | null>(null);
  const [submittedOrder, setSubmittedOrder] = useState<
    SubmittedPublicQrOrder | undefined
  >(() => {
    const tracking = readCustomerTracking(restaurantSlug);
    if (!tracking || tracking.session_id !== checkout.sessionKey)
      return undefined;
    return {
      order_id: tracking.order_id,
      invoice_id: tracking.invoice_id || null,
      invoice_status: tracking.payment_status ?? "pending",
      status: tracking.operational_status ?? "new",
      total_price: 0,
      table_number: tracking.table_number,
      created_at: tracking.updated_at,
    };
  });
  const [activeSession, setActiveSession] =
    useState<PublicQrOrderSession | null>(null);
  const activeSessionRef = useRef<PublicQrOrderSession | null>(null);
  const [realtimeState, setRealtimeState] =
    useState<RealtimeConnectionState>("connecting");
  const realtimeRefreshTimerRef = useRef<number | null>(null);
  const previousActiveSessionId = useRef<string | null>(null);
  const currentSessionKeyRef = useRef(checkout.sessionKey);
  const [submitting, setSubmitting] = useState(false);
  const [cartVisible, setCartVisible] = useState(false);
  const [foodInfoItem, setFoodInfoItem] = useState<MenuItem>();
  const [trackerExpanded, setTrackerExpanded] = useState(false);
  const [showTrackerSuccess, setShowTrackerSuccess] = useState(false);
  const [servedFeedbackOrder, setServedFeedbackOrder] =
    useState<ServedFeedbackOrder | null>(null);
  const [feedbackRating, setFeedbackRating] = useState(5);
  const [feedbackReactions, setFeedbackReactions] = useState<string[]>([]);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [feedbackPhotoFile, setFeedbackPhotoFile] = useState<File | null>(null);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const {
    restaurant,
    categories,
    groups,
    items,
    activeCategoryId,
    searchTerm,
    loading,
    error,
    usingCachedMenu,
    retry,
    setActiveCategoryId,
    setSearchTerm,
  } = useQRMenu(restaurantSlug, menuLanguage);
  setMenuCurrency(
    restaurant
      ? {
          currencyCode: restaurant.currency_code,
          currencySymbol: restaurant.currency_symbol,
          locale: restaurant.locale,
        }
      : null,
  );
  const publicQrSession = useMemo(
    () =>
      buildPublicQrSession(
        checkout,
        restaurant?.id ?? null,
        activeSession?.order_id ?? null,
      ),
    [
      activeSession?.order_id,
      checkout.qrToken,
      checkout.sessionKey,
      checkout.tableNumber,
      restaurant?.id,
    ],
  );
  const nearbyImageInputs = useMemo(() => {
    const activeIndex = activeCategoryId === "all" ? 0 : Math.max(0, categories.findIndex(({ id }) => id === activeCategoryId));
    const nearbyCategoryIds = new Set(categories.slice(activeIndex, activeIndex + 2).map(({ id }) => id));
    return items.filter((item) => activeCategoryId === "all" || nearbyCategoryIds.has(item.category_id)).slice(0, 8).map(publishedMenuImageInput);
  }, [activeCategoryId, categories, items]);
  useSmartImagePrefetch(nearbyImageInputs, "card");

  useEffect(() => {
    let active = true;
    void fetchPublicPaymentRuntime(restaurantSlug)
      .then((runtime) => {
        if (!active) return;
        setPaymentRuntime(runtime);
        const defaultMethod = runtime.methods.find((method) => method.isDefault) ?? runtime.methods[0];
        if (!checkout.paymentMethod && defaultMethod && isPaymentMethod(defaultMethod.displayName)) {
          checkout.setPaymentMethod(defaultMethod.displayName);
        }
      })
      .catch((runtimeError) => {
        if (active) setSubmitError(runtimeError instanceof Error ? runtimeError.message : "Payment configuration is unavailable.");
      });
    return () => { active = false; };
  }, [restaurantSlug]);

  useEffect(() => {
    const previousHtmlLanguage = document.documentElement.lang;
    document.documentElement.lang = MENU_LANGUAGE_OPTIONS.find(
      ({ code }) => code === menuLanguage,
    )?.htmlLang ?? "en";
    try { window.localStorage.setItem("serveflow:menu-language", menuLanguage); }
    catch { /* Language persistence is optional. */ }
    return () => { document.documentElement.lang = previousHtmlLanguage; };
  }, [menuLanguage]);

  useEffect(() => {
    currentSessionKeyRef.current = checkout.sessionKey;
  }, [checkout.sessionKey]);

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  useEffect(() => {
    const orderId = activeSession?.order_id ?? submittedOrder?.order_id;
    if (!orderId || !checkout.sessionKey) return;
    const latestInvoice = activeSession
      ? getLatestInvoice(activeSession.invoices)
      : null;
    persistCustomerTracking({
      restaurant_slug: restaurantSlug,
      session_id: checkout.sessionKey,
      order_id: orderId,
      invoice_id: latestInvoice?.id ?? submittedOrder?.invoice_id ?? "",
      table_number: checkout.tableNumber,
      qr_token: checkout.qrToken,
      browser_session_token: checkout.browserSessionToken,
      operational_status: activeSession?.status ?? submittedOrder?.status,
      payment_status:
        latestInvoice?.status ?? submittedOrder?.invoice_status ?? "pending",
      updated_at: new Date().toISOString(),
    });
  }, [
    activeSession,
    checkout.browserSessionToken,
    checkout.qrToken,
    checkout.sessionKey,
    checkout.tableNumber,
    restaurantSlug,
    submittedOrder,
  ]);

  const refreshActiveSession = useCallback(async () => {
    const requestSessionKey = checkout.sessionKey;

    logPublicQrContext("QRMenuPage:session", {
      restaurantSlug,
      sessionKey: requestSessionKey,
      tableNumber: checkout.tableNumber,
      qrToken: checkout.qrToken,
    });

    if (!checkout.tableNumber || !checkout.qrToken) {
      if (currentSessionKeyRef.current === requestSessionKey) {
        setActiveSession(null);
      }
      return;
    }

    const session = await fetchPublicQrOrderSession({
      restaurantSlug,
      tableNumber: checkout.tableNumber,
      qrToken: checkout.qrToken,
      browserSessionToken: checkout.browserSessionToken,
    });

    if (currentSessionKeyRef.current === requestSessionKey) {
      setActiveSession(session);
    }
  }, [
    checkout.browserSessionToken,
    checkout.qrToken,
    checkout.sessionKey,
    checkout.tableNumber,
    restaurantSlug,
  ]);

  useEffect(() => {
    if (
      !checkout.tableNumberFromQr ||
      !checkout.tableNumber ||
      !checkout.qrToken
    )
      return;

    void logPublicQrScan({
      restaurantSlug,
      tableNumber: checkout.tableNumber,
      qrToken: checkout.qrToken,
    }).catch(() => {
      // Scan analytics must never block public ordering.
    });
  }, [
    checkout.qrToken,
    checkout.tableNumber,
    checkout.tableNumberFromQr,
    restaurantSlug,
  ]);

  useEffect(() => {
    void refreshActiveSession().catch(() => {
      setActiveSession(null);
    });
  }, [refreshActiveSession]);

  useEffect(() => {
    setActiveSession(null);
    setSubmitError(undefined);
    setCartVisible(false);
    setSubmitting(false);
    setFoodInfoItem(undefined);
    setTrackerExpanded(false);
    setShowTrackerSuccess(false);
    setServedFeedbackOrder(null);
    setFeedbackSubmitted(false);
    setFeedbackError(null);
    cart.clearCart();
  }, [checkout.sessionKey, restaurantSlug]);

  useEffect(() => {
    if (!submittedOrder) return;
    setShowTrackerSuccess(true);
    setTrackerExpanded(false);
    const timeoutId = window.setTimeout(() => {
      setShowTrackerSuccess(false);
    }, 2600);
    return () => window.clearTimeout(timeoutId);
  }, [submittedOrder?.invoice_id, submittedOrder?.order_id]);

  useEffect(() => {
    previousActiveSessionId.current = activeSession?.order_id ?? null;
  }, [activeSession?.order_id]);

  useEffect(() => {
    if (!restaurant?.id || !checkout.tableNumber || !checkout.qrToken) return;

    const refresh = () => {
      if (realtimeRefreshTimerRef.current !== null)
        window.clearTimeout(realtimeRefreshTimerRef.current);
      realtimeRefreshTimerRef.current = window.setTimeout(() => {
        realtimeRefreshTimerRef.current = null;
        void refreshActiveSession().catch(() => undefined);
      }, 120);
    };
    const captureServedOrder = (payload: { new: Record<string, unknown> }) => {
      const changedOrder = payload.new;
      if (
        changedOrder?.id === activeSessionRef.current?.order_id &&
        changedOrder?.status === "completed" &&
        activeSessionRef.current
      ) {
        const activeSession = activeSessionRef.current;
        const latestInvoice = getLatestInvoice(activeSession.invoices);
        const feedbackKey = `serveflow.feedback:${activeSession.order_id}`;
        const alreadyHandled = window.localStorage.getItem(feedbackKey);
        if (!alreadyHandled) {
          setServedFeedbackOrder({
            orderId: activeSession.order_id,
            orderLabel: getReadableOrderNumber(
              activeSession.order_id,
              activeSession.display_number,
              activeSession.dining_session_display_number,
            ),
            restaurantId: restaurant.id,
            tableNumber: checkout.tableNumber,
            qrToken: checkout.qrToken,
            sessionKey: checkout.sessionKey,
            invoiceNumber: latestInvoice?.invoice_number ?? 1,
            total: latestInvoice?.total_price ?? activeSession.total_price,
            items: latestInvoice
              ? activeSession.items.filter(
                  (item) => item.invoice_id === latestInvoice.id,
                )
              : activeSession.items,
          });
          setFeedbackRating(5);
          setFeedbackReactions([]);
          setFeedbackComment("");
          setFeedbackPhotoFile(null);
          setFeedbackError(null);
          setFeedbackSubmitted(false);
        }
      }
      refresh();
    };
    const unsubscribe = subscribeCustomerTrackingEvents(
      restaurant.id,
      checkout.browserSessionToken,
      (record) => { captureServedOrder({ new: record }); },
      (status) => { setRealtimeState(status); if (status === "connected") refresh(); },
    );

    return () => {
      if (realtimeRefreshTimerRef.current !== null)
        window.clearTimeout(realtimeRefreshTimerRef.current);
      realtimeRefreshTimerRef.current = null;
      unsubscribe();
    };
  }, [
    checkout.qrToken,
    checkout.sessionKey,
    checkout.tableNumber,
    refreshActiveSession,
    restaurant?.id,
  ]);

  function getTableNumberValidationMessage(tableNumber: string) {
    const normalizedTableNumber = tableNumber.trim();

    if (!normalizedTableNumber) {
      return "Table number is required to place your order.";
    }

    if (!/^[0-9]+$/.test(normalizedTableNumber)) {
      return "Table number must be a whole number.";
    }

    const tableLimit =
      restaurant?.total_tables ?? restaurant?.table_count ?? 20;
    const numericTableNumber = Number(normalizedTableNumber);

    if (numericTableNumber < 1 || numericTableNumber > tableLimit) {
      return `Invalid table number. Please enter a table number between 1 and ${tableLimit}.`;
    }

    if (checkout.tableNumberFromQr && !checkout.qrToken) {
      return "A valid table QR code is required to place this order.";
    }

    return undefined;
  }

  function addItemToCart(item: MenuItem, quantity = 1, notes?: string) {
    setSubmittedOrder(undefined);
    cart.addItem({
      menuItemId: item.id,
      name: item.name,
      price: Number(item.price),
      quantity,
      notes,
    });
  }

  async function submitOrder() {
    const tableNum = checkout.tableNumber.trim();
    const customerName = checkout.customerName.trim();
    const tableNumberValidationMessage =
      getTableNumberValidationMessage(tableNum);

    if (tableNumberValidationMessage) {
      setSubmitError(tableNumberValidationMessage);
      return;
    }

    if (!isPaymentMethod(checkout.paymentMethod)) {
      return;
    }

    setSubmitError(undefined);
    setSubmitting(true);
    const requestSessionKey = checkout.sessionKey;

    try {
      logPublicQrContext("QRMenuPage:submit", {
        restaurantSlug,
        publicQrSession,
      });

      const order = await submitPublicQrOrder({
        restaurantSlug,
        tableNumber: tableNum,
        qrToken: checkout.qrToken,
        browserSessionToken: checkout.browserSessionToken,
        customerName: customerName || undefined,
        paymentMethod: checkout.paymentMethod,
        items: cart.items,
      });

      if (currentSessionKeyRef.current === requestSessionKey) {
        setSubmittedOrder(order);
        cart.clearCart();
        await refreshActiveSession();
        checkout.resetCheckoutState();
      }
    } catch (error) {
      if (currentSessionKeyRef.current === requestSessionKey) {
        setSubmitError(
          error instanceof Error ? error.message : "Order could not be placed.",
        );
      }
    } finally {
      if (currentSessionKeyRef.current === requestSessionKey) {
        setSubmitting(false);
      }
    }
  }

  function dismissFeedback(orderId: string) {
    window.localStorage.setItem(`serveflow.feedback:${orderId}`, "dismissed");
    setServedFeedbackOrder(null);
  }

  async function submitFeedback() {
    if (!servedFeedbackOrder) return;

    try {
      setFeedbackSubmitting(true);
      setFeedbackError(null);
      let photoUrl: string | null = null;

      if (feedbackPhotoFile) {
        photoUrl = await uploadPublicOrderFeedbackPhoto({
          restaurantId: servedFeedbackOrder.restaurantId,
          orderId: servedFeedbackOrder.orderId,
          file: feedbackPhotoFile,
        });
      }

      await submitPublicOrderFeedback({
        restaurantSlug,
        tableNumber: servedFeedbackOrder.tableNumber,
        qrToken: servedFeedbackOrder.qrToken,
        orderId: servedFeedbackOrder.orderId,
        rating: feedbackRating,
        reactions: feedbackReactions,
        comment: feedbackComment.trim() || undefined,
        photoUrl,
        customerSessionKey: servedFeedbackOrder.sessionKey,
      });

      window.localStorage.setItem(
        `serveflow.feedback:${servedFeedbackOrder.orderId}`,
        "submitted",
      );
      setFeedbackSubmitted(true);
    } catch (error) {
      setFeedbackError(
        error instanceof Error
          ? error.message
          : "Feedback could not be submitted.",
      );
    } finally {
      setFeedbackSubmitting(false);
    }
  }

  useEffect(() => {
    if (
      !activeSession ||
      activeSession.status !== "completed" ||
      !restaurant?.id ||
      !checkout.tableNumber ||
      !checkout.qrToken
    ) {
      return;
    }

    const feedbackKey = `serveflow.feedback:${activeSession.order_id}`;
    if (window.localStorage.getItem(feedbackKey)) {
      return;
    }

    if (servedFeedbackOrder?.orderId === activeSession.order_id) {
      return;
    }

    const latestInvoice = getLatestInvoice(activeSession.invoices);
    setFeedbackRating(5);
    setFeedbackReactions([]);
    setFeedbackComment("");
    setFeedbackPhotoFile(null);
    setFeedbackError(null);
    setFeedbackSubmitted(false);

    setServedFeedbackOrder({
      orderId: activeSession.order_id,
      orderLabel: getReadableOrderNumber(
        activeSession.order_id,
        activeSession.display_number,
        activeSession.dining_session_display_number,
      ),
      restaurantId: restaurant.id,
      tableNumber: checkout.tableNumber,
      qrToken: checkout.qrToken,
      sessionKey: checkout.sessionKey,
      invoiceNumber: latestInvoice?.invoice_number ?? 1,
      total: latestInvoice?.total_price ?? activeSession.total_price,
      items: latestInvoice
        ? activeSession.items.filter(
            (item) => item.invoice_id === latestInvoice.id,
          )
        : activeSession.items,
    });
  }, [
    activeSession,
    checkout.qrToken,
    checkout.sessionKey,
    checkout.tableNumber,
    restaurant?.id,
    servedFeedbackOrder?.orderId,
  ]);

  if (loading) {
    return (
      <main className="qr-menu-page">
        <section className="menu-loading" aria-label="Loading menu" role="status" aria-live="polite">
          <span className="visually-hidden">Loading menu</span>
          <div className="skeleton-hero" />
          <div className="skeleton-controls" />
          <div className="skeleton-grid">
            {Array.from({ length: 6 }).map((_, index) => (
              <div className="skeleton-card" key={index} />
            ))}
          </div>
        </section>
      </main>
    );
  }

  if (error || !restaurant) {
    return (
      <main className="qr-menu-page">
        <section className="menu-state" role="alert">
          <h1>Menu unavailable</h1>
          <p>We could not load this menu. Check your connection and try again.</p>
          <button type="button" onClick={retry}>Try Again</button>
        </section>
      </main>
    );
  }

  const activeSessionLatestInvoice = activeSession
    ? getLatestInvoice(activeSession.invoices)
    : null;
  const submittedOrderInvoice =
    submittedOrder?.invoice_id &&
    activeSession?.order_id === submittedOrder.order_id
      ? (activeSession.invoices.find(
          (invoice) => invoice.id === submittedOrder.invoice_id,
        ) ?? null)
      : null;
  const trackingInvoice = submittedOrderInvoice ?? activeSessionLatestInvoice;
  const trackingOrderId = submittedOrder?.order_id ?? activeSession?.order_id;
  const trackingStatus = getCustomerTrackingStatus(
    activeSession?.status ?? submittedOrder?.status,
    trackingInvoice?.status ?? submittedOrder?.invoice_status ?? null,
  );
  const trackingTotal = submittedOrder
    ? (submittedOrder.invoice_total ??
      submittedOrder.added_total ??
      submittedOrder.total_price)
    : (trackingInvoice?.total_price ?? activeSession?.total_price ?? 0);
  const trackingPaymentStatus = canonicalPaymentStatus(
    trackingInvoice?.status ?? submittedOrder?.invoice_status,
  );
  const trackingItems =
    activeSession?.items.filter((item) => {
      if (!trackingInvoice?.id) return true;
      return item.invoice_id === trackingInvoice.id;
    }) ??
    submittedOrder?.items_added ??
    [];
  const trackingStep = customerTrackingStep(trackingStatus);
  const trackingMessage = customerTrackingMessage(trackingStatus);
  const trackingEta = customerTrackingEta(trackingStatus);
  const trackingItemCount = trackingItems.reduce(
    (total, item) => total + item.quantity,
    0,
  );
  const feedbackPhotoUploadEnabled = Boolean(
    restaurant.ordering_settings?.feedback_photo_uploads,
  );
  const feedbackReactionOptions = [
    "Delicious 😋",
    "Fast Service ⚡",
    "Friendly Staff 😊",
    "Great Atmosphere ✨",
    "Value for Money 💰",
  ];
  const progressSteps = [
    { label: "Sent", title: "Order Sent", icon: "✓" },
    { label: "Pay", title: "Payment Confirmation", icon: "•" },
    { label: "Prep", title: "Preparing", icon: "👨‍🍳" },
    { label: "Ready", title: "Ready", icon: "🍽" },
    { label: "Served", title: "Served", icon: "✓" },
  ];

  return (
    <ThemeProvider restaurant={restaurant}>
      <ThemeRenderer
        restaurant={restaurant}
        categories={categories}
        menu={items}
        cart={{ items: cart.items, itemCount: cart.itemCount, subtotal: cart.displaySubtotal, visible: cartVisible }}
        order={{ activeSession, submittedOrder: submittedOrder ?? null }}
        theme={resolveMenuTheme(restaurant.menu_theme)}
        language={menuLanguage}
      >
        <main className="qr-menu-page modern-food-page">
      <label className="qr-language-selector">
        <select
          value={menuLanguage}
          aria-label="Menu language"
          title="Menu language"
          onChange={(event) => setMenuLanguage(event.target.value as MenuLanguage)}
        >
          {MENU_LANGUAGE_OPTIONS.map((option) => (
            <option key={option.code} value={option.code} title={option.nativeLabel}>
              {option.code.toUpperCase()}
            </option>
          ))}
        </select>
      </label>
      {usingCachedMenu ? (
        <div role="status" className="qr-offline-state">
          <span>Showing the last saved menu. Prices and availability may have changed.</span>
          <button type="button" onClick={retry}>Refresh</button>
        </div>
      ) : null}
      {realtimeState !== "connected" ? (
        <div role="status" className="qr-realtime-state">
          Realtime reconnecting…
        </div>
      ) : null}
      {modernNavigation.page === "home" ? (
        <ModernFoodView
        restaurant={restaurant}
        tableNumber={checkout.tableNumber}
        categories={categories}
        groups={groups}
        activeCategoryId={activeCategoryId}
        searchTerm={searchTerm}
        cartItemCount={cart.itemCount}
        cartSubtotal={cart.displaySubtotal}
        hasActiveOrder={Boolean(trackingOrderId)}
        onSearchChange={setSearchTerm}
        onCategoryChange={setActiveCategoryId}
        onAddToCart={addItemToCart}
        onOpenInfo={setFoodInfoItem}
        onOpenCart={() => {
          checkout.setCheckoutVisible(false);
          setCartVisible(true);
        }}
        onOpenOrders={() => {
          checkout.setCheckoutVisible(false);
          setCartVisible(false);
          setFoodInfoItem(undefined);
          modernNavigation.navigate("orders");
        }}
        />
      ) : (
        <ModernOrdersView
          restaurant={restaurant}
          onNavigateHome={() => modernNavigation.navigate("home")}
          activeOrder={trackingOrderId ? (
        <section
          id="modern-order-tracker"
          className={`public-order-tracker${trackerExpanded ? " expanded" : ""}${showTrackerSuccess ? " success" : ""}`}
          aria-label="Order tracking"
          aria-live="polite"
        >
          {showTrackerSuccess ? (
            <div className="tracker-success-pop" role="status">
              <span className="tracker-success-check" aria-hidden="true">
                ✓
              </span>
              <div>
                <strong>Order sent</strong>
                <span>Your bill is now being tracked.</span>
              </div>
            </div>
          ) : null}
          <button
            className="tracker-compact"
            type="button"
            aria-expanded={trackerExpanded}
            onClick={() => setTrackerExpanded((expanded) => !expanded)}
          >
            <span className="tracker-status-line">
              <span
                className={`tracker-live-dot step-${trackingStep}`}
                aria-hidden="true"
              />
              <span>{trackingMessage}</span>
            </span>
            <span className="tracker-topline">
              <strong>
                {getReadableOrderNumber(
                  trackingOrderId,
                  submittedOrder?.display_number ??
                    activeSession?.display_number,
                  submittedOrder?.dining_session_display_number ??
                    activeSession?.dining_session_display_number,
                )}{" "}
                · Receipt{" "}
                {getReadableInvoiceNumber(trackingInvoice, submittedOrder)}
              </strong>
              <span>{formatMenuPrice(trackingTotal)}</span>
            </span>
            <span className="tracker-meta">
              <span>{trackingEta}</span>
              <span>
                {trackingItemCount} {trackingItemCount === 1 ? "item" : "items"}
              </span>
              <span>Order: {formatStatusLabel(trackingStatus)}</span>
              <span>Payment: {paymentLabel(trackingPaymentStatus)}</span>
            </span>
            <span className="tracker-toggle" aria-hidden="true">
              {trackerExpanded ? "⌃" : "⌄"}
            </span>
          </button>
          <CanonicalLifecycleStatus
            operationalStatus={trackingStatus}
            paymentStatus={trackingPaymentStatus}
            kitchenProgress={trackingStatus}
          />
          <div className="tracker-timeline" aria-label="Order progress">
            {progressSteps.map((step, index) => {
              const done = index < trackingStep;
              const active = index === trackingStep;
              return (
                <div
                  className={`tracker-step${done ? " done" : ""}${active ? " active" : ""}`}
                  key={step.title}
                >
                  <span className="tracker-step-dot" aria-hidden="true">
                    {done ? "✓" : step.icon}
                  </span>
                  <span>{step.label}</span>
                </div>
              );
            })}
          </div>
          {trackerExpanded ? (
            <div className="tracker-details">
              <div className="tracker-detail-heading">
                <strong>Ordered items</strong>
                <span>{trackingEta}</span>
              </div>
              <div className="tracker-item-list">
                {trackingItems.length > 0 ? (
                  trackingItems.map((item) => (
                    <div className="tracker-item-row" key={item.id}>
                      <div>
                        <strong>{item.name}</strong>
                        <span>Qty {item.quantity}</span>
                      </div>
                      <span>{formatMenuPrice(item.line_total)}</span>
                    </div>
                  ))
                ) : (
                  <div className="tracker-empty">
                    Items will appear here as soon as the order syncs.
                  </div>
                )}
              </div>
              <div className="tracker-total-row">
                <span>Total amount</span>
                <strong>{formatMenuPrice(trackingTotal)}</strong>
              </div>
            </div>
          ) : null}
        </section>
          ) : null}
          previousOrder={servedFeedbackOrder ? (
        <section className="public-feedback-card" aria-label="Meal feedback">
          {feedbackSubmitted ? (
            <div className="feedback-thank-you" role="status">
              <span aria-hidden="true">🎉</span>
              <strong>Thank you for your feedback!</strong>
              <p>Your opinion helps us improve.</p>
            </div>
          ) : (
            <>
              <div className="feedback-card-heading">
                <div>
                  <span className="feedback-eyebrow">Order served</span>
                  <h2>Before you leave, how was your meal?</h2>
                  <p>
                    Order {servedFeedbackOrder.orderLabel} · Receipt{" "}
                    {servedFeedbackOrder.invoiceNumber}
                  </p>
                </div>
                <strong>{formatMenuPrice(servedFeedbackOrder.total)}</strong>
              </div>

              <div className="feedback-stars" aria-label="Rate your experience">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    className={star <= feedbackRating ? "active" : ""}
                    aria-label={`${star} star${star === 1 ? "" : "s"}`}
                    onClick={() => setFeedbackRating(star)}
                  >
                    ★
                  </button>
                ))}
              </div>

              <div className="feedback-chip-list" aria-label="Quick reactions">
                {feedbackReactionOptions.map((reaction) => {
                  const reactionLabel = reaction.replace(/\s[^\s]+$/u, "");
                  const selected = feedbackReactions.includes(reactionLabel);
                  return (
                    <button
                      key={reaction}
                      type="button"
                      className={selected ? "selected" : ""}
                      onClick={() => {
                        setFeedbackReactions((current) =>
                          selected
                            ? current.filter((item) => item !== reactionLabel)
                            : [...current, reactionLabel],
                        );
                      }}
                    >
                      {reaction}
                    </button>
                  );
                })}
              </div>

              <label className="feedback-text-field">
                <span>Tell us about your experience...</span>
                <textarea
                  value={feedbackComment}
                  rows={3}
                  maxLength={1000}
                  onChange={(event) => setFeedbackComment(event.target.value)}
                  placeholder="Tell us about your experience..."
                />
              </label>

              {feedbackPhotoUploadEnabled ? (
                <label className="feedback-photo-field">
                  <span>
                    {feedbackPhotoFile
                      ? feedbackPhotoFile.name
                      : "Add an optional photo"}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) =>
                      setFeedbackPhotoFile(event.target.files?.[0] ?? null)
                    }
                  />
                </label>
              ) : null}

              {feedbackError ? (
                <p className="feedback-error">{feedbackError}</p>
              ) : null}

              <div className="feedback-actions">
                <button
                  type="button"
                  className="feedback-submit"
                  disabled={feedbackSubmitting}
                  onClick={submitFeedback}
                >
                  {feedbackSubmitting ? "Submitting..." : "Submit Feedback"}
                </button>
                <button
                  type="button"
                  className="feedback-later"
                  onClick={() => dismissFeedback(servedFeedbackOrder.orderId)}
                >
                  Maybe Later
                </button>
              </div>
            </>
          )}
        </section>
          ) : null}
        />
      )}
      {modernNavigation.page === "home" ? (
        <>
      <div className="qr-menu-shell modern-food-order-shell">
        <aside className="qr-menu-side" aria-label="Order panel">
          {checkout.checkoutVisible && cart.items.length > 0 ? (
            <PublicQrCheckoutPanel
              customerName={checkout.customerName}
              activeSession={activeSession}
              displaySubtotal={cart.displaySubtotal}
              items={cart.items}
              paymentMethod={checkout.paymentMethod}
              enabledPaymentMethods={paymentRuntime?.methods ?? []}
              restaurantName={restaurant.name}
              submitting={submitting}
              submitError={submitError}
              tableNumber={checkout.tableNumber}
              tableCount={
                restaurant.total_tables ?? restaurant.table_count ?? 20
              }
              tableNumberFromQr={checkout.tableNumberFromQr}
              onClose={() => checkout.setCheckoutVisible(false)}
              onCustomerNameChange={checkout.setCustomerName}
              onTableNumberChange={checkout.setTableNumber}
              onPaymentMethodChange={checkout.setPaymentMethod}
              onSubmit={submitOrder}
            />
          ) : (
            <PublicQrCartPanel
              items={cart.items}
              activeSession={activeSession}
              itemCount={cart.itemCount}
              displaySubtotal={cart.displaySubtotal}
              isOpen={cartVisible}
              onClose={() => setCartVisible(false)}
              onIncrease={(menuItemId, quantity) =>
                cart.updateQuantity(menuItemId, quantity + 1)
              }
              onDecrease={(menuItemId, quantity) =>
                cart.updateQuantity(menuItemId, quantity - 1)
              }
              onRemove={cart.removeItem}
              onReviewOrder={() => {
                checkout.setCheckoutVisible(true);
                setCartVisible(false);
              }}
            />
          )}
        </aside>
      </div>
      <PublicQrCartPanel
        items={cart.items}
        activeSession={activeSession}
        itemCount={cart.itemCount}
        displaySubtotal={cart.displaySubtotal}
        isFloatingOnly
        isOpen={cartVisible}
        onClose={() => setCartVisible(false)}
        onIncrease={(menuItemId, quantity) =>
          cart.updateQuantity(menuItemId, quantity + 1)
        }
        onDecrease={(menuItemId, quantity) =>
          cart.updateQuantity(menuItemId, quantity - 1)
        }
        onRemove={cart.removeItem}
        onReviewOrder={() => checkout.setCheckoutVisible(true)}
      />
      {cart.itemCount > 0 ? (
        <button
          className="floating-cart-entry"
          type="button"
          onClick={() => {
            checkout.setCheckoutVisible(false);
            setCartVisible(true);
          }}
          aria-label="Open cart"
        >
          <span aria-hidden="true">Cart</span>
          <strong>
            {cart.itemCount} {cart.itemCount === 1 ? "Item" : "Items"} -{" "}
            {formatMenuPrice(cart.displaySubtotal)}
          </strong>
        </button>
      ) : null}
      <FoodInfoPanel
        item={foodInfoItem}
        onClose={() => setFoodInfoItem(undefined)}
        onAddToCart={(item, quantity, notes) => {
          addItemToCart(item, quantity, notes);
          setFoodInfoItem(undefined);
          setCartVisible(true);
        }}
      />
        </>
      ) : null}
        </main>
      </ThemeRenderer>
    </ThemeProvider>
  );
}
