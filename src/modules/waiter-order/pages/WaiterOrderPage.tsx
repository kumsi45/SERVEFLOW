import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SmartImage } from "../../../core/presentation/SmartImage";
import { publishedMenuImageInput } from "../../../core/presentation/menuItemImage";
import { resolveSmartImage } from "../../../core/presentation/smartImageDelivery";
import {
  formatMenuPrice,
  setMenuCurrency,
} from "../../qr-menu/components/menuPresentation";
import { useQRMenu } from "../../qr-menu/hooks/useQRMenu";
import type { MenuItem } from "../../qr-menu/types";
import { usePublicQrCart } from "../../public-qr-ordering/hooks/usePublicQrCart";
import {
  fetchWaiterOrderSession,
  queueWaiterOrder,
  submitWaiterOrder,
  type WaiterOrderSession,
} from "../services/waiterOrderService";
import "../styles/waiterOrder.css";

type Props = { restaurantSlug: string; tableNumber: string };

const NOTE_PRESETS = [
  "No onions",
  "No spice",
  "Extra spicy",
  "No salt",
  "Sauce on side",
  "Allergy alert",
];

function WaiterMenuImage({ item }: { item: MenuItem }) {
  const image = resolveSmartImage(publishedMenuImageInput(item), "card");

  return image.url ? (
    <SmartImage
      resolution={image}
      alt=""
      fallback="Image"
      fallbackClassName="w93-placeholder"
    />
  ) : (
    <span className="w93-placeholder">Image</span>
  );
}

function readIds(key: string) {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function navigateWaiter(path: string, replace = false) {
  if (replace) window.history.replaceState({}, "", path);
  else window.history.pushState({}, "", path);

  try {
    window.dispatchEvent(new PopStateEvent("popstate"));
  } catch {
    window.dispatchEvent(new Event("popstate"));
  }
}

function createClientRequestId() {
  if (typeof window.crypto?.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const random = Math.floor(Math.random() * 16);
    const value = token === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function mergeNotes(current: string, note: string) {
  const parts = current
    .split(" / ")
    .map((value) => value.trim())
    .filter(Boolean);
  return parts.includes(note)
    ? parts.filter((value) => value !== note).join(" / ")
    : [...parts, note].join(" / ");
}

export function WaiterOrderPage({ restaurantSlug, tableNumber }: Props) {
  const menu = useQRMenu(restaurantSlug);
  const cart = usePublicQrCart(restaurantSlug, `waiter:${tableNumber}`, { persist: false });
  const favoriteKey = `serveflow.waiter.favorites:${restaurantSlug}`;
  const recentKey = `serveflow.waiter.recents:${restaurantSlug}`;
  const submitLockedRef = useRef(false);
  const addFeedbackTimer = useRef<number | null>(null);
  const [session, setSession] = useState<WaiterOrderSession | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [favorites, setFavorites] = useState<string[]>(() =>
    readIds(favoriteKey),
  );
  const [recents, setRecents] = useState<string[]>(() => readIds(recentKey));
  const [noteItemId, setNoteItemId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [orderNoteOpen, setOrderNoteOpen] = useState(false);
  const [orderNote, setOrderNote] = useState("");
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [orderSheetOpen, setOrderSheetOpen] = useState(false);
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  const [sentSummary, setSentSummary] = useState<{
    tableNumber: string;
    itemCount: number;
  } | null>(null);

  useEffect(() => {
    setMenuCurrency(
      menu.restaurant
        ? {
            currencyCode: menu.restaurant.currency_code,
            currencySymbol: menu.restaurant.currency_symbol,
            locale: menu.restaurant.locale,
          }
        : null,
    );
  }, [menu.restaurant]);

  const refresh = useCallback(async () => {
    const value = await fetchWaiterOrderSession(restaurantSlug, tableNumber);
    setSession(value);
    setCustomerName((current) => current || value.customer_name || "");
    setOrderNote((current) => current || value.orderNote || "");
  }, [restaurantSlug, tableNumber]);

  useEffect(() => {
    void refresh()
      .catch((e) =>
        setError(
          e instanceof Error ? e.message : "Order workspace unavailable.",
        ),
      )
      .finally(() => setLoadingSession(false));
  }, [refresh]);

  useEffect(
    () => localStorage.setItem(favoriteKey, JSON.stringify(favorites)),
    [favoriteKey, favorites],
  );
  useEffect(
    () => localStorage.setItem(recentKey, JSON.stringify(recents)),
    [recentKey, recents],
  );
  useEffect(
    () => () => {
      if (addFeedbackTimer.current !== null) {
        window.clearTimeout(addFeedbackTimer.current);
      }
    },
    [],
  );
  useEffect(() => {
    if (!sentSummary) return;
    const timer = window.setTimeout(
      () =>
        navigateWaiter(
          `/waiter/dashboard?table=${encodeURIComponent(sentSummary.tableNumber)}`,
          true,
        ),
      1400,
    );
    return () => window.clearTimeout(timer);
  }, [sentSummary]);

  const itemById = useMemo(
    () => new Map(menu.items.map((item) => [item.id, item])),
    [menu.items],
  );
  const favoriteItems = favorites.flatMap((id) => itemById.get(id) ?? []);
  const recentItems = recents.flatMap((id) => itemById.get(id) ?? []);
  const frequentItems = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of session?.items ?? []) {
      counts.set(item.menu_item_id, (counts.get(item.menu_item_id) ?? 0) + item.quantity);
    }
    return [...counts]
      .sort((a, b) => b[1] - a[1])
      .flatMap(([id]) => itemById.get(id) ?? [])
      .slice(0, 8);
  }, [itemById, session?.items]);
  const visibleItems = useMemo(
    () => menu.groups.flatMap((group) => group.items),
    [menu.groups],
  );
  const quickSections = [
    { title: "Favorites", items: favoriteItems },
    { title: "Recent", items: recentItems },
    { title: "Popular Here", items: frequentItems },
  ].filter((section) => section.items.length);

  const noteLine = noteItemId
    ? cart.items.find((line) => line.menuItemId === noteItemId)
    : null;
  const backPath = session?.order_id
    ? `/waiter/dashboard?table=${encodeURIComponent(tableNumber)}`
    : "/waiter/dashboard";

  function remember(item: MenuItem) {
    setRecents((current) =>
      [item.id, ...current.filter((id) => id !== item.id)].slice(0, 12),
    );
  }

  function showAdded(itemId: string) {
    setLastAddedId(itemId);
    if (addFeedbackTimer.current !== null) {
      window.clearTimeout(addFeedbackTimer.current);
    }
    addFeedbackTimer.current = window.setTimeout(
      () => setLastAddedId(null),
      450,
    );
  }

  function add(item: MenuItem) {
    if (!item.available) return;
    cart.addItem({
      menuItemId: item.id,
      name: item.name,
      price: Number(item.price),
      quantity: 1,
    });
    remember(item);
    showAdded(item.id);
  }

  function openNote(menuItemId: string) {
    const line = cart.items.find((item) => item.menuItemId === menuItemId);
    if (!line) return;
    setNoteItemId(menuItemId);
    setNoteDraft(line.notes ?? "");
  }

  function saveNote() {
    if (!noteItemId) return;
    cart.updateNotes(noteItemId, noteDraft);
    setNoteItemId(null);
  }

  function toggleFavorite(id: string) {
    setFavorites((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [id, ...current],
    );
  }

  async function submit() {
    if (submitLockedRef.current || submitting) return;
    if (cart.items.length === 0) {
      setError("Add at least one menu item before sending the order.");
      return;
    }

    submitLockedRef.current = true;
    setSubmitting(true);
    setError(null);

    try {
      const sentItemCount = cart.itemCount;
      const payload = {
        clientRequestId: createClientRequestId(),
        restaurantSlug: restaurantSlug.trim(),
        tableNumber: String(tableNumber).trim(),
        customerName: customerName.trim(),
        customerPhone: session?.customerPhone?.trim() ?? "",
        orderNote: orderNote.trim(),
        items: cart.items.map((item) => ({ ...item })),
      };

      if (!window.navigator.onLine) {
        queueWaiterOrder(payload);
        cart.clearCart();
        navigateWaiter("/waiter/dashboard", true);
        return;
      }

      const submittedOrder = await submitWaiterOrder(payload);
      if (!submittedOrder.order_id) {
        throw new Error("The server did not confirm the dining-session order.");
      }

      cart.clearCart();
      setOrderSheetOpen(false);
      setSentSummary({ tableNumber: String(tableNumber), itemCount: sentItemCount });
    } catch (submitError) {
      submitLockedRef.current = false;
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Order could not be submitted. Your cart has been preserved.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const orderPanel = (
    <>
      <div className="w93-cart-title">
        <div>
          <small>Current Order</small>
          <h2>Table {tableNumber}</h2>
        </div>
        <strong>{cart.itemCount}</strong>
      </div>
      <div className="w93-cart-lines">
        {cart.items.length ? (
          cart.items.map((line) => (
            <article key={line.menuItemId}>
              <div>
                <strong>{line.name}</strong>
                {line.notes ? <small>{line.notes}</small> : null}
              </div>
              <b>{formatMenuPrice(line.price * line.quantity)}</b>
              <div className="w93-qty">
                <button
                  type="button"
                  aria-label={`Remove one ${line.name}`}
                  onClick={() =>
                    line.quantity === 1
                      ? cart.removeItem(line.menuItemId)
                      : cart.updateQuantity(line.menuItemId, line.quantity - 1)
                  }
                >
                  -
                </button>
                <strong>{line.quantity}</strong>
                <button
                  type="button"
                  aria-label={`Add one ${line.name}`}
                  onClick={() =>
                    cart.updateQuantity(line.menuItemId, line.quantity + 1)
                  }
                >
                  +
                </button>
                <button type="button" onClick={() => openNote(line.menuItemId)}>
                  + Note
                </button>
              </div>
            </article>
          ))
        ) : (
          <div className="w93-empty">Tap + on an item.</div>
        )}
      </div>
      <div className="w93-secondary-actions">
        <button type="button" onClick={() => setOrderNoteOpen(true)}>
          {orderNote.trim() ? "Edit Order Note" : "+ Order Note"}
        </button>
        <button type="button" onClick={() => setCustomerOpen(true)}>
          {customerName.trim() ? "Edit Customer" : "Customer"}
        </button>
      </div>
      {orderNote.trim() ? (
        <p className="w93-order-note">{orderNote.trim()}</p>
      ) : null}
      {customerName.trim() ? (
        <p className="w93-customer-note">Customer: {customerName.trim()}</p>
      ) : null}
      {error ? (
        <div className="w93-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="w93-total">
        <span>Total</span>
        <strong>{formatMenuPrice(cart.displaySubtotal)}</strong>
      </div>
      <button
        type="button"
        className="w93-submit"
        disabled={!cart.items.length || submitting}
        onClick={submit}
      >
        {submitting
          ? "Sending..."
          : session?.order_id
            ? "Send Added Items"
            : "Send Order"}
      </button>
    </>
  );

  if (sentSummary) {
    return (
      <main className="w93-page w93-sent-page">
        <section className="w93-sent" role="status" aria-live="polite">
          <span aria-hidden="true">✓</span>
          <h1>ORDER SENT</h1>
          <strong>TABLE {sentSummary.tableNumber}</strong>
          <p>
            {sentSummary.itemCount} item
            {sentSummary.itemCount === 1 ? "" : "s"}
          </p>
          <button
            type="button"
            onClick={() =>
              navigateWaiter(
                `/waiter/dashboard?table=${encodeURIComponent(sentSummary.tableNumber)}`,
                true,
              )
            }
          >
            DONE
          </button>
        </section>
      </main>
    );
  }

  if (menu.loading || loadingSession) {
    return (
      <main className="w93-page">
        <div className="w93-state">Loading menu...</div>
      </main>
    );
  }

  if (menu.error || (error && !session) || !menu.restaurant) {
    return (
      <main className="w93-page">
        <div className="w93-state error">
          <strong>Order workspace unavailable</strong>
          <span>{menu.error || error}</span>
          <button onClick={() => navigateWaiter("/waiter/dashboard", true)}>
            Back to Tables
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="w93-page">
      <header className="w93-header">
        <button onClick={() => navigateWaiter(backPath, true)}>
          Back to Tables
        </button>
        <div>
          <strong>Table {tableNumber}</strong>
          <span>{session?.order_id ? "Add Items" : "New Order"}</span>
        </div>
        <div className="w93-running-total">
          <small>{cart.itemCount} items</small>
          <strong>{formatMenuPrice(cart.displaySubtotal)}</strong>
        </div>
      </header>

      <div className="w93-layout">
        <section className="w93-catalog" aria-label="Menu">
          <div className="w93-search">
            <span aria-hidden="true">Search</span>
            <input
              value={menu.searchTerm}
              onChange={(e) => menu.setSearchTerm(e.target.value)}
              placeholder="Search food or drinks"
              autoFocus
            />
          </div>
          <nav className="w93-categories" aria-label="Menu categories">
            <button
              className={menu.activeCategoryId === "all" ? "active" : ""}
              onClick={() => menu.setActiveCategoryId("all")}
            >
              All
            </button>
            {menu.categories.map((category) => (
              <button
                key={category.id}
                className={
                  menu.activeCategoryId === category.id ? "active" : ""
                }
                onClick={() => menu.setActiveCategoryId(category.id)}
              >
                {category.name}
              </button>
            ))}
          </nav>
          {!menu.searchTerm &&
            menu.activeCategoryId === "all" &&
            quickSections.map((section) => (
              <section className="w93-quick" key={section.title}>
                <h2>{section.title}</h2>
                <div>
                  {section.items.slice(0, 8).map((item) => (
                    <button
                      key={item.id}
                      disabled={!item.available}
                      onClick={() => add(item)}
                    >
                      <span>{item.name}</span>
                      <strong>+ {formatMenuPrice(Number(item.price))}</strong>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          <section className="w93-menu-grid">
            {visibleItems.map((item) => {
              const line = cart.items.find(
                (cartItem) => cartItem.menuItemId === item.id,
              );
              return (
                <article
                  key={item.id}
                  className={[
                    !item.available ? "unavailable" : "",
                    lastAddedId === item.id ? "added" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <button
                    className="w93-favorite"
                    onClick={() => toggleFavorite(item.id)}
                    aria-label={
                      favorites.includes(item.id)
                        ? `Remove ${item.name} from favorites`
                        : `Add ${item.name} to favorites`
                    }
                  >
                    {favorites.includes(item.id) ? "*" : "+"}
                  </button>
                  <button
                    className="w93-item-main"
                    disabled={!item.available}
                    onClick={() => add(item)}
                  >
                    <WaiterMenuImage item={item} />
                    <span className="w93-item-copy">
                      <strong>{item.name}</strong>
                      <b>{formatMenuPrice(Number(item.price))}</b>
                    </span>
                    <i>{line ? line.quantity : "+"}</i>
                    {!item.available ? (
                      <em className="w93-unavailable">Unavailable</em>
                    ) : null}
                  </button>
                </article>
              );
            })}
          </section>
        </section>

        <aside className="w93-cart">{orderPanel}</aside>
      </div>

      <div className="w93-mobile-summary">
        <button type="button" onClick={() => setOrderSheetOpen(true)}>
          <span>
            {cart.itemCount} items - {formatMenuPrice(cart.displaySubtotal)}
          </span>
          <strong>View Order</strong>
        </button>
      </div>

      {orderSheetOpen ? (
        <div
          className="w93-sheet-bg"
          onClick={() => setOrderSheetOpen(false)}
        >
          <section
            className="w93-sheet w93-order-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Current order"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <small>Current Order</small>
                <h2>Table {tableNumber}</h2>
              </div>
              <button onClick={() => setOrderSheetOpen(false)}>x</button>
            </header>
            {orderPanel}
          </section>
        </div>
      ) : null}

      {noteItemId && noteLine ? (
        <div className="w93-sheet-bg" onClick={() => setNoteItemId(null)}>
          <section
            className="w93-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Item note"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <small>Item Note</small>
                <h2>{noteLine.name}</h2>
              </div>
              <button onClick={() => setNoteItemId(null)}>x</button>
            </header>
            <div className="w93-presets">
              {NOTE_PRESETS.map((note) => (
                <button
                  key={note}
                  className={noteDraft.includes(note) ? "active" : ""}
                  onClick={() => setNoteDraft((current) => mergeNotes(current, note))}
                >
                  {note}
                </button>
              ))}
            </div>
            <label>
              <span>Kitchen note</span>
              <textarea
                autoFocus
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="No sugar"
              />
            </label>
            <button className="w93-save" onClick={saveNote}>
              Save Note
            </button>
          </section>
        </div>
      ) : null}

      {orderNoteOpen ? (
        <div className="w93-sheet-bg" onClick={() => setOrderNoteOpen(false)}>
          <section
            className="w93-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Order note"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <small>Order Note</small>
                <h2>Table {tableNumber}</h2>
              </div>
              <button onClick={() => setOrderNoteOpen(false)}>x</button>
            </header>
            <label>
              <span>Kitchen or service note</span>
              <textarea
                autoFocus
                value={orderNote}
                onChange={(e) => setOrderNote(e.target.value)}
                placeholder="Serve together"
              />
            </label>
            <button className="w93-save" onClick={() => setOrderNoteOpen(false)}>
              Save Order Note
            </button>
          </section>
        </div>
      ) : null}

      {customerOpen ? (
        <div className="w93-sheet-bg" onClick={() => setCustomerOpen(false)}>
          <section
            className="w93-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Customer"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <small>Optional</small>
                <h2>Customer</h2>
              </div>
              <button onClick={() => setCustomerOpen(false)}>x</button>
            </header>
            <label>
              <span>Name</span>
              <input
                autoFocus
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Optional name"
              />
            </label>
            <button className="w93-save" onClick={() => setCustomerOpen(false)}>
              Save Customer
            </button>
          </section>
        </div>
      ) : null}
    </main>
  );
}
