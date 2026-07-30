import { useCallback, useEffect, useMemo, useState } from "react";
import { SmartImage } from "../../../core/presentation/SmartImage";
import { publishedMenuImageInput } from "../../../core/presentation/menuItemImage";
import { resolveSmartImage } from "../../../core/presentation/smartImageDelivery";
import { formatMenuPrice, setMenuCurrency } from "../../qr-menu/components/menuPresentation";
import { useQRMenu } from "../../qr-menu/hooks/useQRMenu";
import type { MenuItem } from "../../qr-menu/types";
import { usePublicQrCart } from "../../public-qr-ordering/hooks/usePublicQrCart";
import { getStoredWaiterSession } from "../../waiter-auth/services/waiterAuthService";
import { fetchWaiterOrderSession, queueWaiterOrder, submitWaiterOrder, type WaiterOrderSession } from "../services/waiterOrderService";
import "../styles/waiterOrder.css";

type Props = { restaurantSlug: string; tableNumber: string };
function WaiterMenuImage({ item }: { item: MenuItem }) {
  const image = resolveSmartImage(publishedMenuImageInput(item), "card");
  return image.url ? <SmartImage resolution={image} alt="" fallback="🍽" fallbackClassName="w93-placeholder" /> : <span className="w93-placeholder">🍽</span>;
}
const NOTE_PRESETS = ["No onions", "No spice", "Extra spicy", "No salt", "Sauce on side", "Allergy alert"];
function readIds(key: string) { try { const value = JSON.parse(localStorage.getItem(key) ?? "[]"); return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []; } catch { return []; } }
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

export function WaiterOrderPage({ restaurantSlug, tableNumber }: Props) {
  const waiterSession = getStoredWaiterSession(restaurantSlug);
  const menu = useQRMenu(restaurantSlug);
  setMenuCurrency(menu.restaurant ? {
    currencyCode: menu.restaurant.currency_code,
    currencySymbol: menu.restaurant.currency_symbol,
    locale: menu.restaurant.locale,
  } : null);
  const cart = usePublicQrCart(restaurantSlug, `waiter:${tableNumber}`, { persist: false });
  const favoriteKey = `serveflow.waiter.favorites:${restaurantSlug}`;
  const recentKey = `serveflow.waiter.recents:${restaurantSlug}`;
  const [session, setSession] = useState<WaiterOrderSession | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [favorites, setFavorites] = useState<string[]>(() => readIds(favoriteKey));
  const [recents, setRecents] = useState<string[]>(() => readIds(recentKey));
  const [modifierItem, setModifierItem] = useState<MenuItem | null>(null);
  const [modifierQuantity, setModifierQuantity] = useState(1);
  const [modifierNotes, setModifierNotes] = useState("");
  const [orderNote, setOrderNote] = useState("");
  const [customerName, setCustomerName] = useState("");

  const refresh = useCallback(async () => { const value = await fetchWaiterOrderSession(restaurantSlug, tableNumber); setSession(value); setCustomerName((current) => current || value.customer_name || ""); setOrderNote((current) => current || value.orderNote || ""); }, [restaurantSlug, tableNumber]);
  useEffect(() => { void refresh().catch((e) => setError(e instanceof Error ? e.message : "Order workspace unavailable.")).finally(() => setLoadingSession(false)); }, [refresh]);
  useEffect(() => localStorage.setItem(favoriteKey, JSON.stringify(favorites)), [favoriteKey, favorites]);
  useEffect(() => localStorage.setItem(recentKey, JSON.stringify(recents)), [recentKey, recents]);

  const itemById = useMemo(() => new Map(menu.items.map((item) => [item.id, item])), [menu.items]);
  const favoriteItems = favorites.flatMap((id) => itemById.get(id) ?? []);
  const recentItems = recents.flatMap((id) => itemById.get(id) ?? []);
  const frequentItems = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of session?.items ?? []) counts.set(item.menu_item_id, (counts.get(item.menu_item_id) ?? 0) + item.quantity);
    return [...counts].sort((a,b) => b[1] - a[1]).flatMap(([id]) => itemById.get(id) ?? []).slice(0,8);
  }, [itemById, session?.items]);

  function remember(item: MenuItem) { setRecents((current) => [item.id, ...current.filter((id) => id !== item.id)].slice(0,12)); }
  function add(item: MenuItem) { cart.addItem({ menuItemId:item.id,name:item.name,price:Number(item.price),quantity:1 }); remember(item); }
  function customize(item: MenuItem) { const existing = cart.items.find((line) => line.menuItemId === item.id); setModifierItem(item); setModifierQuantity(existing?.quantity ?? 1); setModifierNotes(existing?.notes ?? ""); }
  function saveCustomization() { if (!modifierItem) return; const existing = cart.items.find((line) => line.menuItemId === modifierItem.id); if (existing) { cart.updateQuantity(modifierItem.id, modifierQuantity); cart.updateNotes(modifierItem.id, modifierNotes); } else cart.addItem({ menuItemId:modifierItem.id,name:modifierItem.name,price:Number(modifierItem.price),quantity:modifierQuantity,notes:modifierNotes }); remember(modifierItem); setModifierItem(null); }
  function toggleFavorite(id:string) { setFavorites((current) => current.includes(id) ? current.filter((value) => value !== id) : [id,...current]); }
  async function submit() {
    if (submitting) return;
    if (cart.items.length === 0) {
      setError("Add at least one menu item before sending the order.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
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
      navigateWaiter(
        `/waiter/dashboard?table=${encodeURIComponent(tableNumber)}`,
        true,
      );
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Order could not be submitted. Your cart has been preserved.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (menu.loading || loadingSession) return <main className="w93-page"><div className="w93-state">Loading fast order…</div></main>;
  if (menu.error || error && !session || !menu.restaurant) return <main className="w93-page"><div className="w93-state error"><strong>Order workspace unavailable</strong><span>{menu.error || error}</span><button onClick={() => navigateWaiter("/waiter/dashboard",true)}>Back to Tables</button></div></main>;

  const quickSections = [{title:"Favorites",items:favoriteItems},{title:"Recent Items",items:recentItems},{title:"Frequently Ordered",items:frequentItems}].filter((section) => section.items.length);
  return <main className="w93-page">
    <header className="w93-header"><button onClick={() => navigateWaiter(session?.order_id?`/waiter/dashboard?table=${encodeURIComponent(tableNumber)}`:"/waiter/dashboard",true)}>← {session?.order_id?"Session":"Tables"}</button><div><strong>Table {tableNumber}</strong><span>{waiterSession?.displayName ?? session?.waiterDisplayName ?? "Waiter"} · {session?.order_id ? "Add items" : "New order"}</span></div><div className="w93-running-total"><small>{cart.itemCount} items</small><strong>{formatMenuPrice(cart.displaySubtotal)}</strong></div></header>
    <div className="w93-layout"><section className="w93-catalog">
      <div className="w93-search"><span>⌕</span><input value={menu.searchTerm} onChange={(e) => menu.setSearchTerm(e.target.value)} placeholder="Search food or drinks" autoFocus /></div>
      <nav className="w93-categories"><button className={menu.activeCategoryId === "all" ? "active" : ""} onClick={() => menu.setActiveCategoryId("all")}>All Items</button>{menu.categories.map((category) => <button key={category.id} className={menu.activeCategoryId === category.id ? "active" : ""} onClick={() => menu.setActiveCategoryId(category.id)}>{category.name}</button>)}</nav>
      {!menu.searchTerm && menu.activeCategoryId === "all" && quickSections.map((section) => <section className="w93-quick" key={section.title}><h2>{section.title}</h2><div>{section.items.slice(0,8).map((item) => <button key={item.id} onClick={() => add(item)}><span>{item.name}</span><strong>+ {formatMenuPrice(Number(item.price))}</strong></button>)}</div></section>)}
      <section className="w93-menu-grid">{menu.groups.flatMap((group) => group.items).map((item) => <article key={item.id} className={!item.available ? "unavailable" : ""}><button className="w93-favorite" onClick={() => toggleFavorite(item.id)} aria-label="Favorite">{favorites.includes(item.id)?"★":"☆"}</button><button className="w93-item-main" disabled={!item.available} onClick={() => add(item)}><WaiterMenuImage item={item} /><span className="w93-item-copy"><strong>{item.name}</strong><small>{item.description || "Tap to add"}</small><b>{formatMenuPrice(Number(item.price))}</b></span><i>＋</i></button><button className="w93-customize" onClick={() => customize(item)} disabled={!item.available}>Modifiers & Notes</button></article>)}</section>
    </section><aside className="w93-cart"><div className="w93-cart-title"><div><small>Current Order</small><h2>Table {tableNumber}</h2></div><strong>{cart.itemCount}</strong></div><div className="w93-cart-lines">{cart.items.length?cart.items.map((line) => <article key={line.menuItemId}><div><strong>{line.name}</strong><small>{line.notes || "No instructions"}</small></div><b>{formatMenuPrice(line.price*line.quantity)}</b><div className="w93-qty"><button type="button" onClick={() => line.quantity===1?cart.removeItem(line.menuItemId):cart.updateQuantity(line.menuItemId,line.quantity-1)}>−</button><strong>{line.quantity}</strong><button type="button" onClick={() => cart.updateQuantity(line.menuItemId,line.quantity+1)}>+</button><button type="button" onClick={() => customize(itemById.get(line.menuItemId)!)}>✎</button></div></article>):<div className="w93-empty">Tap an item to add it instantly.</div>}</div><label className="w93-field"><span>Customer</span><input value={customerName} onChange={(e)=>setCustomerName(e.target.value)} placeholder="Optional name" /></label><label className="w93-field"><span>Special instructions for this order</span><textarea value={orderNote} onChange={(e)=>setOrderNote(e.target.value)} placeholder="Kitchen or service notes" /></label>{error&&<div className="w93-error" role="alert">{error}</div>}<div className="w93-total"><span>Total</span><strong>{formatMenuPrice(cart.displaySubtotal)}</strong></div><button type="button" className="w93-submit" disabled={!cart.items.length||submitting} onClick={submit}>{submitting?"Sending…":session?.order_id?"Send Added Items":"Send Order"}</button></aside></div>
    {modifierItem && <div className="w93-sheet-bg" onClick={() => setModifierItem(null)}><section className="w93-sheet" onClick={(e)=>e.stopPropagation()}><header><div><small>Customize item</small><h2>{modifierItem.name}</h2></div><button onClick={()=>setModifierItem(null)}>×</button></header><div className="w93-sheet-qty"><span>Quantity</span><div><button onClick={()=>setModifierQuantity((q)=>Math.max(1,q-1))}>−</button><strong>{modifierQuantity}</strong><button onClick={()=>setModifierQuantity((q)=>Math.min(99,q+1))}>+</button></div></div><div className="w93-presets">{NOTE_PRESETS.map((note)=><button key={note} className={modifierNotes.includes(note)?"active":""} onClick={()=>setModifierNotes((current)=>current.includes(note)?current.split(" · ").filter((value)=>value!==note).join(" · "):[current,note].filter(Boolean).join(" · "))}>{note}</button>)}</div><label><span>Kitchen notes / special instructions</span><textarea autoFocus value={modifierNotes} onChange={(e)=>setModifierNotes(e.target.value)} placeholder="Preparation details, allergy notes, substitutions…" /></label><button className="w93-save" onClick={saveCustomization}>Save Item · {formatMenuPrice(Number(modifierItem.price)*modifierQuantity)}</button></section></div>}
  </main>;
}

