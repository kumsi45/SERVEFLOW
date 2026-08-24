import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  Activity, BarChart3, BookOpen, CookingPot, Gem, Heart,
  Home, Menu, Package, UtensilsCrossed, Users, X,
} from "lucide-react";
import { useModalFocus } from "../../../core/accessibility/useModalFocus";
import type { CurrencyConfig } from "../../../core/format/currency";
import { ServeFlowBrand } from "../../../core/presentation/ServeFlowBrand";
import { signOutStaff } from "../../staff-auth/services/staffAuthService";
import { ManagerCopilot } from "./ManagerCopilot";
import { clearManagerDataCache, retainManagerTenantCache } from "../services/managerDataCache";
import { preloadManagerSection } from "../managerPageModules";
import "../styles/managerLayout.css";

type Props = {
  restaurantId: string;
  restaurantName: string;
  managerName: string;
  section: string;
  currency?: CurrencyConfig;
  children: ReactNode;
};

const MANAGER_NAV = [
  { key: "dashboard", label: "Dashboard", mobileLabel: "Dashboard", href: "/manager/dashboard", icon: Home },
  { key: "tables", label: "Live Operations", mobileLabel: "Operations", href: "/manager/tables", icon: Activity },
  { key: "kitchen", label: "Kitchen", mobileLabel: "Kitchen", href: "/manager/kitchen", icon: CookingPot },
  { key: "staff", label: "Staff", mobileLabel: "Staff", href: "/manager/staff", icon: Users },
  { key: "customers", label: "Guests", mobileLabel: "Guests", href: "/manager/customers", icon: Heart },
  { key: "reports", label: "Reports", mobileLabel: "Reports", href: "/manager/reports", icon: BarChart3 },
  { key: "intelligence", label: "Business Intelligence", mobileLabel: "Intelligence", href: "/manager/intelligence", icon: Gem },
  { key: "recipes", label: "Recipes", mobileLabel: "Recipes", href: "/manager/recipes", icon: BookOpen },
  { key: "menu", label: "Menu", mobileLabel: "Menu", href: "/manager/menu", icon: UtensilsCrossed },
  { key: "inventory", label: "Inventory", mobileLabel: "Inventory", href: "/manager/inventory", icon: Package },
];

const MOBILE_PRIMARY_NAV = MANAGER_NAV.filter((item) => ["dashboard", "tables", "kitchen", "staff"].includes(item.key));
const MOBILE_SECONDARY_NAV = MANAGER_NAV.filter((item) => ["customers", "reports", "intelligence", "recipes", "menu", "inventory"].includes(item.key));

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "SF";
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" }).format(value);
}

function formatTime(value: Date) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(value);
}

export function ManagerLayout({ restaurantId, restaurantName, managerName, section, currency, children }: Props) {
  const [now, setNow] = useState(() => new Date());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileDrawerRef = useRef<HTMLElement>(null);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  const activeSection = section === "cashier" || section === "tables" ? "tables" : section;

  useModalFocus(
    mobileMenuOpen,
    () => setMobileMenuOpen(false),
    mobileDrawerRef,
    mobileCloseRef,
  );

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => { retainManagerTenantCache(restaurantId); }, [restaurantId]);

  function navigate(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    event.preventDefault();
    if (href.startsWith("/inventory/")) {
      window.sessionStorage.setItem("serveflow.active-restaurant:inventory", restaurantId);
    }
    window.history.pushState({}, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
    setMobileMenuOpen(false);
  }

  async function logout() {
    clearManagerDataCache();
    await signOutStaff();
    window.location.replace("/staff-login");
  }

  return (
    <main className="ml-shell">
      <aside className="ml-sidebar ml-desktop-sidebar" aria-label="Manager navigation">
        <div className="ml-sidebar-brand">
          <ServeFlowBrand variant="compact" />
        </div>
        <nav className="ml-sidebar-nav">
          {MANAGER_NAV.map((item) => {
            const Icon = item.icon;
            return <a
              className={activeSection === item.key ? "is-active" : ""}
              href={item.href}
              key={item.key}
              onPointerEnter={() => void preloadManagerSection(item.key)}
              onFocus={() => void preloadManagerSection(item.key)}
              onTouchStart={() => void preloadManagerSection(item.key)}
              onClick={(event) => navigate(event, item.href)}
            >
              <span className="ml-nav-icon" aria-hidden="true"><Icon strokeWidth={1.9} /></span>
              {item.label}
            </a>;
          })}
        </nav>
        <div className="ml-sidebar-footer">
          <div className="ml-sidebar-profile">
            <span>{initials(managerName)}</span>
            <div>
              <strong>{managerName}</strong>
              <small>General Manager</small>
            </div>
          </div>
          <button type="button" onClick={() => void logout()}>Logout</button>
        </div>
      </aside>
      {mobileMenuOpen && <aside
        id="manager-mobile-navigation"
        ref={mobileDrawerRef}
        className="ml-mobile-drawer is-open"
        role="dialog"
        aria-modal="true"
        aria-label="Secondary Manager navigation"
        tabIndex={-1}
      >
        <div className="ml-mobile-drawer-heading">
          <ServeFlowBrand variant="compact" />
          <button ref={mobileCloseRef} type="button" aria-label="Close navigation" onClick={() => setMobileMenuOpen(false)}><X aria-hidden="true" /></button>
        </div>
        <nav className="ml-mobile-drawer-nav">
          {MOBILE_SECONDARY_NAV.map((item) => {
            const Icon = item.icon;
            return <a
              className={activeSection === item.key ? "is-active" : ""}
              href={item.href}
              key={item.key}
              onPointerEnter={() => void preloadManagerSection(item.key)}
              onFocus={() => void preloadManagerSection(item.key)}
              onTouchStart={() => void preloadManagerSection(item.key)}
              onClick={(event) => navigate(event, item.href)}
            >
              <span className="ml-nav-icon" aria-hidden="true"><Icon strokeWidth={1.9} /></span>
              {item.label}
            </a>;
          })}
        </nav>
        <div className="ml-mobile-account">
          <div className="ml-sidebar-profile">
            <span>{initials(managerName)}</span>
            <div><strong>{managerName}</strong><small>General Manager</small></div>
          </div>
          <button type="button" onClick={() => void logout()}>Logout</button>
        </div>
      </aside>}
      {mobileMenuOpen && <button className="ml-sidebar-scrim" type="button" aria-label="Close navigation" onClick={() => setMobileMenuOpen(false)} />}

      <section className="ml-workspace">
        <header className="ml-header">
          <div className="ml-mobile-brand"><ServeFlowBrand variant="compact" /></div>
          <div className="ml-header-left">
            <div className="ml-logo" aria-hidden="true"><span>{initials(restaurantName)}</span></div>
            <div className="ml-restaurant-title">
              <strong>{restaurantName}</strong>
            </div>
          </div>
          <div className="ml-header-meta">
            <div className="ml-clock">
              <strong>{formatTime(now)}</strong>
              <span>{formatDate(now)}</span>
            </div>
            <button className="ml-menu-button" type="button" aria-label="Open navigation" aria-expanded={mobileMenuOpen} aria-controls="manager-mobile-navigation" onClick={() => setMobileMenuOpen(true)}><Menu aria-hidden="true" /></button>
            <div className="ml-profile">
              <span>{initials(managerName)}</span>
              <strong>{managerName}</strong>
            </div>
          </div>
        </header>
        <div className="ml-content">{children}</div>
        <nav className="ml-bottom-nav" aria-label="Primary mobile navigation">
          {MOBILE_PRIMARY_NAV.map((item) => { const Icon = item.icon; return <a key={item.key} className={activeSection === item.key ? "is-active" : ""} href={item.href} onPointerDown={() => void preloadManagerSection(item.key)} onFocus={() => void preloadManagerSection(item.key)} onClick={(event) => navigate(event, item.href)}><span className="ml-nav-icon" aria-hidden="true"><Icon strokeWidth={1.9} /></span>{item.mobileLabel}</a>; })}
        </nav>
        <ManagerCopilot restaurantId={restaurantId} restaurantName={restaurantName} managerName={managerName} section={section} currency={currency}/>
      </section>
    </main>
  );
}
