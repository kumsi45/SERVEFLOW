import { useMemo, useState } from "react";
import { MENU_LANGUAGE_OPTIONS, type MenuLanguage } from "../../../core/menu/menuLanguage";
import { ThemeProvider } from "../../menu/theme-engine/ThemeProvider";
import { ThemeRenderer } from "../../menu/theme-engine/ThemeRenderer";
import { MENU_THEMES, type MenuTheme } from "../../menu/theme-engine/ThemeTypes";
import { ModernFoodView } from "../../menu/theme-engine/themes/modern/ModernFoodView";
import { groupMenuItemsByCategory } from "../../qr-menu/services/menuGrouping";
import { localizeMenuPresentation } from "../../qr-menu/services/menuLocalization";
import type { MenuCategory, MenuItem, Restaurant } from "../../qr-menu/types";
import type { MenuReviewState } from "../services/menuReviewTypes";
import type { MenuPreviewRestaurant } from "../services/menuPublishService";

type Props = { restaurant: MenuPreviewRestaurant; state: MenuReviewState; onReturn: () => void; onPublish: () => void; publishing: boolean };
type Device = "desktop" | "tablet" | "mobile";
type Orientation = "portrait" | "landscape";

export function AiMenuFinalPreview({ restaurant: sourceRestaurant, state, onReturn, onPublish, publishing }: Props) {
  const [device, setDevice] = useState<Device>("mobile");
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [language, setLanguage] = useState<MenuLanguage>("en");
  const [theme, setTheme] = useState<MenuTheme>(sourceRestaurant.menu_theme ?? "modern");
  const [activeCategoryId, setActiveCategoryId] = useState("all");
  const [search, setSearch] = useState("");
  const restaurant: Restaurant = { ...sourceRestaurant, menu_theme: theme };
  const categories = useMemo<MenuCategory[]>(() => state.categories.map((category) => ({ id: category.id, restaurant_id: sourceRestaurant.id, name: category.name, display_order: category.order, localizations: Object.fromEntries(MENU_LANGUAGE_OPTIONS.map(({ code }) => [code, { name: category.localization.values[code].value, description: null }])) })), [sourceRestaurant.id, state.categories]);
  const items = useMemo<MenuItem[]>(() => state.items.filter((item) => item.approved && !item.deleted && !item.hidden && !item.rejected && item.categoryId).map((item) => {
    const selected = item.imageDraft.versions.find((version) => version.id === item.imageDraft.selectedVersionId && (version.status === "Approved" || version.status === "Owner Upload"));
    return { id: item.id, restaurant_id: sourceRestaurant.id, category_id: item.categoryId!, name: item.name.value ?? "Untitled item", description: item.description.value, price: item.price.value ?? 0, image_url: selected?.imageUrl ?? null, effective_image_url: selected?.imageUrl ?? null, available: true, localizations: Object.fromEntries(MENU_LANGUAGE_OPTIONS.map(({ code }) => [code, { name: item.nameLocalization.values[code].value, description: item.descriptionLocalization.values[code].value }])) };
  }), [sourceRestaurant.id, state.items]);
  const localized = useMemo(() => localizeMenuPresentation(categories, items, language), [categories, items, language]);
  const groups = useMemo(() => groupMenuItemsByCategory(localized.categories, localized.items.filter((item) => activeCategoryId === "all" || item.category_id === activeCategoryId).filter((item) => !search.trim() || item.name.toLowerCase().includes(search.trim().toLowerCase()))), [activeCategoryId, localized, search]);
  return <section className="menu-final-preview" aria-label="Final digital menu preview">
    <header><div><span>Customer simulation</span><h2>Preview Digital Menu</h2><p>This is the production QR menu renderer. Nothing is published yet.</p></div><div><button type="button" onClick={onReturn}>Return to Review Studio</button><button className="setup-primary" type="button" disabled={publishing} onClick={onPublish}>{publishing ? "Publishing..." : "Publish Menu"}</button></div></header>
    <div className="menu-preview-controls" aria-label="Preview controls">
      {(["desktop", "tablet", "mobile"] as Device[]).map((value) => <button type="button" className={device === value ? "active" : ""} onClick={() => setDevice(value)} key={value}>{value[0].toUpperCase() + value.slice(1)}</button>)}
      {(["portrait", "landscape"] as Orientation[]).map((value) => <button type="button" className={orientation === value ? "active" : ""} onClick={() => setOrientation(value)} key={value}>{value[0].toUpperCase() + value.slice(1)}</button>)}
      <select aria-label="Preview language" value={language} onChange={(event) => setLanguage(event.target.value as MenuLanguage)}>{MENU_LANGUAGE_OPTIONS.map((option) => <option value={option.code} key={option.code}>{option.label}</option>)}</select>
      <select aria-label="Preview theme" value={theme} onChange={(event) => setTheme(event.target.value as MenuTheme)}>{MENU_THEMES.map((value) => <option value={value} key={value}>{value.replace("_", " ")}</option>)}</select>
    </div>
    <div className={`menu-preview-stage ${device} ${orientation}`}><div className="menu-preview-device">
      <ThemeProvider restaurant={restaurant}><ThemeRenderer restaurant={restaurant} categories={localized.categories} menu={localized.items} cart={{ items: [], itemCount: 0, subtotal: 0, visible: false }} order={{ activeSession: null, submittedOrder: null }} theme={theme} language={language}>
        <ModernFoodView restaurant={restaurant} categories={localized.categories} groups={groups} activeCategoryId={activeCategoryId} searchTerm={search} cartItemCount={0} cartSubtotal={0} hasActiveOrder={false} onSearchChange={setSearch} onCategoryChange={setActiveCategoryId} onAddToCart={() => undefined} onOpenInfo={() => undefined} onOpenCart={() => undefined} onOpenOrders={() => undefined} />
      </ThemeRenderer></ThemeProvider>
    </div></div>
  </section>;
}
