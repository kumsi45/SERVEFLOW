import { useMemo, useState } from "react";
import { MENU_LANGUAGE_OPTIONS, type MenuLanguage } from "../../../core/menu/menuLanguage";
import { resolveMenuItemImage, type MenuImageCandidate } from "../../../core/presentation/menuItemImage";
import { ThemeProvider } from "../../menu/theme-engine/ThemeProvider";
import { ThemeRenderer } from "../../menu/theme-engine/ThemeRenderer";
import { MENU_THEMES, type MenuTheme } from "../../menu/theme-engine/ThemeTypes";
import { ModernFoodView } from "../../menu/theme-engine/themes/modern/ModernFoodView";
import { PublicQrCartPanel } from "../../public-qr-ordering/components/PublicQrCartPanel";
import type { PublicQrCartItem } from "../../public-qr-ordering/types";
import { FoodInfoPanel } from "../../qr-menu/components/FoodInfoPanel";
import { groupMenuItemsByCategory } from "../../qr-menu/services/menuGrouping";
import { localizeMenuPresentation } from "../../qr-menu/services/menuLocalization";
import type { MenuCategory, MenuItem, Restaurant } from "../../qr-menu/types";
import { certifyMenuPreview } from "../services/menuPreviewCertification";
import type { MenuReviewState } from "../services/menuReviewTypes";
import type { MenuPreviewRestaurant } from "../services/menuPublishService";
import { SERVEFLOW_MENU_PLACEHOLDER_IMAGE } from "../services/ownerMenuItemDefaults";

type Props = { restaurant: MenuPreviewRestaurant; state: MenuReviewState; draftVersion: number; lastUpdated: string; onReturn: () => void; onPublish: (theme: MenuTheme) => void; publishing: boolean };
type Device = "desktop" | "tablet" | "mobile";
type Orientation = "portrait" | "landscape";

export function AiMenuFinalPreview({ restaurant: sourceRestaurant, state, draftVersion, lastUpdated, onReturn, onPublish, publishing }: Props) {
  const [device, setDevice] = useState<Device>("mobile");
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [language] = useState<MenuLanguage>("en");
  const [theme, setTheme] = useState<MenuTheme>(sourceRestaurant.menu_theme ?? "modern");
  const [activeCategoryId, setActiveCategoryId] = useState("all");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<PublicQrCartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [foodInfoItem, setFoodInfoItem] = useState<MenuItem>();
  const [refreshKey, setRefreshKey] = useState(0);
  const certification = useMemo(() => certifyMenuPreview(sourceRestaurant, state), [sourceRestaurant, state]);
  const restaurant: Restaurant = { ...sourceRestaurant, menu_theme: theme };
  const categories = useMemo<MenuCategory[]>(() => state.categories.map((category) => ({ id: category.id, restaurant_id: sourceRestaurant.id, name: category.name, display_order: category.order, localizations: Object.fromEntries(MENU_LANGUAGE_OPTIONS.map(({ code }) => [code, { name: category.localization.values[code].value, description: null }])) })), [sourceRestaurant.id, state.categories]);
  const items = useMemo<MenuItem[]>(() => certification.items.filter((item) => item.categoryId).map((item) => {
    const selected = item.imageDraft.versions.find((version) => version.id === item.imageDraft.selectedVersionId) ?? null;
    const candidate = selected ? {
      id: selected.id,
      source: selected.source === "owner" ? "CUSTOM" : "MASTER",
      status: selected.source === "owner" ? "APPROVED" : (item.imageDraft.masterImageStatus ?? "PENDING_REVIEW"),
      url: selected.imageUrl,
      thumbnailUrl: selected.thumbnailUrl,
      version: selected.version,
      storagePath: selected.storagePath,
      width: selected.width,
      height: selected.height,
      mimeType: selected.mimeType,
      checksumSha256: selected.checksumSha256,
      metadata: selected.providerMetadata,
    } satisfies MenuImageCandidate : null;
    const image = resolveMenuItemImage({ itemId: item.id, custom: candidate?.source === "CUSTOM" ? candidate : null, master: candidate?.source === "MASTER" ? candidate : null, placeholderUrl: SERVEFLOW_MENU_PLACEHOLDER_IMAGE }, "owner-review");
    return { id: item.id, restaurant_id: sourceRestaurant.id, category_id: item.categoryId!, name: item.name.value ?? "Untitled item", description: item.description.value, price: item.price.value ?? 0, image_url: image.source === "PLACEHOLDER" ? null : image.url, effective_image_url: image.url, custom_image: candidate?.source === "CUSTOM" ? candidate : null, master_image: candidate?.source === "MASTER" ? candidate : null, available: true, localizations: Object.fromEntries(MENU_LANGUAGE_OPTIONS.map(({ code }) => [code, { name: item.nameLocalization.values[code].value, description: item.descriptionLocalization.values[code].value }])) };
  }), [certification.items, sourceRestaurant.id]);
  const localized = useMemo(() => localizeMenuPresentation(categories, items, language), [categories, items, language]);
  const groups = useMemo(() => groupMenuItemsByCategory(localized.categories, localized.items.filter((item) => activeCategoryId === "all" || item.category_id === activeCategoryId).filter((item) => !search.trim() || `${item.name} ${item.description ?? ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))), [activeCategoryId, localized, search]);
  const itemCount = cart.reduce((total, item) => total + item.quantity, 0);
  const subtotal = cart.reduce((total, item) => total + item.price * item.quantity, 0);
  const updateQuantity = (id: string, quantity: number) => setCart((current) => quantity < 1 ? current.filter((item) => item.menuItemId !== id) : current.map((item) => item.menuItemId === id ? { ...item, quantity } : item));
  const addToCart = (item: MenuItem, quantity = 1, notes?: string) => { setCart((current) => { const existing = current.find((entry) => entry.menuItemId === item.id); return existing ? current.map((entry) => entry.menuItemId === item.id ? { ...entry, quantity: entry.quantity + quantity, notes: notes ?? entry.notes } : entry) : [...current, { menuItemId: item.id, name: item.name, price: item.price, quantity, notes }]; }); setCartOpen(true); };
  const refresh = () => { setSearch(""); setActiveCategoryId("all"); setCart([]); setCartOpen(false); setFoodInfoItem(undefined); setRefreshKey((value) => value + 1); };

  return <section className="menu-final-preview" aria-label="Final digital menu preview">
    <header className="menu-preview-toolbar"><div><span>Customer preview</span><h2>Preview Digital Menu</h2></div><div className="menu-preview-actions"><button type="button" onClick={refresh}>Refresh Preview</button><button type="button" onClick={onReturn}>Back to Edit</button><button className="setup-primary" type="button" disabled={publishing || !certification.canPublish} onClick={() => onPublish(theme)}>{publishing ? "Publishing..." : "Publish Menu"}</button></div></header>
    <div className="menu-preview-controls" aria-label="Preview controls">
      <div role="group" aria-label="Device size">{(["desktop", "tablet", "mobile"] as Device[]).map((value) => <button type="button" aria-pressed={device === value} className={device === value ? "active" : ""} onClick={() => setDevice(value)} key={value}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div>
      <div className="menu-orientation-picker" role="group" aria-label="Screen orientation">{(["portrait", "landscape"] as Orientation[]).map((value) => <button type="button" aria-label={`${value} preview`} title={`${value[0].toUpperCase() + value.slice(1)} preview`} aria-pressed={orientation === value} className={orientation === value ? "active" : ""} onClick={() => setOrientation(value)} key={value}><span className={`menu-orientation-shape ${value}`} aria-hidden="true" /></button>)}</div>
      <label><span>Theme</span><select aria-label="Preview theme" value={theme} onChange={(event) => setTheme(event.target.value as MenuTheme)}>{MENU_THEMES.map((value) => <option value={value} key={value}>{value.replace("_", " ")}</option>)}</select></label>
      <div className="menu-supported-languages" aria-label="Supported languages"><span><b>Menu languages</b><small>Available automatically</small></span><strong><i>✓</i> English</strong><strong><i>✓</i> Amharic</strong><strong><i>✓</i> Afaan Oromoo</strong></div>
    </div>
    <div className="menu-preview-certification">
      <section className="menu-ready-checklist" aria-labelledby="menu-ready-title"><header><div><span>Pre-publish certification</span><h3 id="menu-ready-title">Ready to publish</h3></div><strong className={certification.canPublish ? "ready" : "attention"}>{certification.canPublish ? "Required setup complete" : "Required setup incomplete"}</strong></header><div>{certification.checks.filter((check) => check.blocking).map((check) => <article className={check.ready ? "ready" : "attention"} key={check.id}><span aria-hidden="true">{check.ready ? "✓" : "•"}</span><div><strong>{check.label}</strong><small>{check.detail}</small></div></article>)}</div><p className="menu-optional-note"><span aria-hidden="true">✓</span><span><strong>Optional details are covered</strong><small>ServeFlow defaults are used until you add them later.</small></span></p></section>
      <section className="menu-preview-summary" aria-labelledby="menu-summary-title"><h3 id="menu-summary-title">Menu Summary</h3><dl><div><dt>Menu Items</dt><dd>{certification.summary.itemCount}</dd></div><div><dt>Categories</dt><dd>{certification.summary.categoryCount}</dd></div><div><dt>Languages</dt><dd>{certification.summary.languageCount}</dd></div><div><dt>Theme</dt><dd>{theme.replace("_", " ")}</dd></div><div><dt>Last Updated</dt><dd>{new Date(lastUpdated).toLocaleString()}</dd></div><div><dt>Draft Version</dt><dd>{draftVersion}</dd></div><div><dt>Images Generated</dt><dd>{certification.summary.itemCount - certification.summary.missingImages}</dd></div><div><dt>Missing Images</dt><dd>{certification.summary.missingImages}</dd></div><div><dt>Missing Price</dt><dd>{certification.summary.missingPrices}</dd></div><div><dt>Missing Description</dt><dd>{certification.summary.missingDescriptions}</dd></div><div><dt>Hidden Items</dt><dd>{certification.summary.hiddenItems}</dd></div></dl></section>
    </div>
    <div className={`menu-preview-stage ${device} ${orientation}`}><div className="menu-preview-device" key={refreshKey}>
      <ThemeProvider restaurant={restaurant}><ThemeRenderer restaurant={restaurant} categories={localized.categories} menu={localized.items} cart={{ items: cart, itemCount, subtotal, visible: cartOpen }} order={{ activeSession: null, submittedOrder: null }} theme={theme} language={language}>
        <main className="qr-menu-page modern-food-page preview-customer-menu"><ModernFoodView restaurant={restaurant} categories={localized.categories} groups={groups} activeCategoryId={activeCategoryId} searchTerm={search} cartItemCount={itemCount} cartSubtotal={subtotal} hasActiveOrder={false} onSearchChange={setSearch} onCategoryChange={setActiveCategoryId} onAddToCart={(item) => addToCart(item)} onOpenInfo={setFoodInfoItem} onOpenCart={() => setCartOpen(true)} onOpenOrders={() => undefined} />
          <PublicQrCartPanel items={cart} itemCount={itemCount} displaySubtotal={subtotal} isOpen={cartOpen} onClose={() => setCartOpen(false)} onIncrease={updateQuantity} onDecrease={updateQuantity} onRemove={(id) => setCart((current) => current.filter((item) => item.menuItemId !== id))} onReviewOrder={() => setCartOpen(false)} />
          <FoodInfoPanel item={foodInfoItem} onClose={() => setFoodInfoItem(undefined)} onAddToCart={(item, quantity, notes) => { addToCart(item, quantity, notes); setFoodInfoItem(undefined); }} />
        </main>
      </ThemeRenderer></ThemeProvider>
    </div></div>
  </section>;
}
