import { useRef, useState } from "react";
import { ArrowRight, BarChart3, ChefHat, ClipboardList, Menu, Package, QrCode, Store, UsersRound, X } from "lucide-react";
import "../styles/landing.css";
import { PublicSiteFooter } from "../components/PublicSiteChrome";
import { usePublicMetadata } from "../hooks/usePublicMetadata";
import { usePublicHashScroll } from "../hooks/usePublicHashScroll";
import { PublicThemeToggle } from "../components/PublicThemeToggle";

const navigation = [
  { label: "Platform", href: "#platform" }, { label: "Industries", href: "#industries" },
  { label: "About", href: "/about" }, { label: "Pricing", href: "/pricing" }, { label: "Contact", href: "/contact" },
] as const;
const industries = [
  ["Restaurants", "Bring orders, kitchen coordination, cashier work, and everyday operations into one connected workflow."],
  ["Cafés & coffee shops", "Support quick service with a digital menu, clear order flow, and the operational visibility teams need."],
  ["Hotels & lodges", "Serve food-and-beverage outlets with tools for service, staff, kitchen, and business operations."],
  ["Bars & lounges", "Coordinate menus, service teams, and order workflows for hospitality venues with fast-moving service."],
  ["Other hospitality businesses", "Adapt verified ServeFlow service workflows to the way your food-and-beverage operation works."],
] as const;
const capabilities = [
  [QrCode, "QR menus & ordering", "Give guests a browser-based menu and a direct path to place an order."],
  [ClipboardList, "Owner & staff workflows", "Give teams role-based workspaces for the responsibilities they manage every day."],
  [Store, "Cashier operations", "Keep payment review and customer-order activity in a dedicated cashier workspace."],
  [ChefHat, "Kitchen workflows", "Help kitchen teams work through the order queue with a focused operational view."],
  [Package, "Inventory management", "Track stock, movements, adjustments, and related inventory work in one place."],
  [BarChart3, "Reporting", "Review operational reporting from owner and manager workspaces as your team needs it."],
] as const;

export function LandingPage() {
  usePublicHashScroll();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuToggle = useRef<HTMLButtonElement | null>(null);
  usePublicMetadata("ServeFlow | Hospitality operations platform", "ServeFlow connects service, orders, staff, inventory, and business performance for hospitality operations.");
  const closeMenu = (restoreFocus = false) => {
    setMenuOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => menuToggle.current?.focus());
  };

  return <div className="lp-root">
    <a className="lp-skip-link" href="#main-content">Skip to content</a>
    <header className="lp-header">
      <nav className="lp-nav lp-container" aria-label="Main navigation">
        <a href="/" className="lp-brand" aria-label="ServeFlow home" onClick={() => closeMenu()}><img src="/serveflowlogo.png" alt="" width="36" height="36"/><span>ServeFlow</span></a>
        <div className="lp-desktop-nav">{navigation.map((item) => <a key={item.href} href={item.href}>{item.label}</a>)}</div>
        <div className="lp-desktop-actions"><a className="lp-text-link" href="/staff-login">Sign in</a><a className="lp-button lp-button-small" href="/sign-up">Get started</a></div>
        <a className="lp-mobile-signin" href="/staff-login">Sign in</a>
        <PublicThemeToggle />
        <button ref={menuToggle} type="button" className="lp-menu-toggle" aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"} aria-expanded={menuOpen} aria-controls="public-mobile-navigation" onClick={() => setMenuOpen((open) => !open)}>{menuOpen ? <X aria-hidden="true"/> : <Menu aria-hidden="true"/>}</button>
      </nav>
      {menuOpen && <div id="public-mobile-navigation" className="lp-mobile-menu" onKeyDown={(event) => { if (event.key === "Escape") closeMenu(true); }}><div className="lp-container">
        {navigation.map((item) => <a key={item.href} href={item.href} onClick={() => closeMenu()}>{item.label}</a>)}
        <a href="/staff-login" onClick={() => closeMenu()}>Sign in</a><a className="lp-button" href="/sign-up" onClick={() => closeMenu()}>Get started <ArrowRight aria-hidden="true" size={18}/></a>
      </div></div>}
    </header>
    <main id="main-content">
      <section className="lp-hero"><div className="lp-container lp-hero-grid"><div className="lp-hero-copy">
        <p className="lp-eyebrow">Hospitality operations, connected</p><h1>One Platform. Every Hospitality Experience.</h1>
        <p className="lp-lede">Manage your hospitality operations with connected tools for service, orders, staff, inventory, and business performance.</p>
        <div className="lp-actions"><a className="lp-button" href="/sign-up">Get started <ArrowRight aria-hidden="true" size={18}/></a><a className="lp-button lp-button-secondary" href="#platform">Explore the platform</a></div><p className="lp-hero-note">Built for hospitality teams managing food-and-beverage service.</p>
      </div><div className="lp-hero-image-wrap"><img className="lp-hero-image" src="/serveflow-auth-hospitality.png" alt="Hospitality team serving guests in a restaurant setting"/></div></div></section>
      <section className="lp-section lp-platform" id="platform" aria-labelledby="platform-title"><div className="lp-container"><div className="lp-section-intro"><p className="lp-eyebrow">The platform</p><h2 id="platform-title">Connected tools for the work behind great service.</h2><p>ServeFlow brings the operational work around service into focused, role-aware workspaces.</p></div><div className="lp-capability-grid">
        {capabilities.map(([Icon, title, description]) => <article key={title} className="lp-capability-card"><Icon aria-hidden="true" size={24} strokeWidth={1.8}/><h3>{title}</h3><p>{description}</p></article>)}
      </div></div></section>
      <section className="lp-section lp-industries" id="industries" aria-labelledby="industries-title"><div className="lp-container"><div className="lp-section-intro"><p className="lp-eyebrow">Industries</p><h2 id="industries-title">Built around hospitality service.</h2><p>Different venues have different rhythms. ServeFlow focuses on the operational workflows shared by food-and-beverage teams.</p></div><div className="lp-industry-grid">
        {industries.map(([title, description], index) => <article key={title} className={`lp-industry-card lp-industry-${index + 1}`}><span>{String(index + 1).padStart(2, "0")}</span><h3>{title}</h3><p>{description}</p></article>)}
      </div></div></section>
      <section className="lp-section lp-benefits" id="about" aria-labelledby="about-title"><div className="lp-container lp-about-grid"><div><p className="lp-eyebrow">About ServeFlow</p><h2 id="about-title">Give every team a clearer way to run service.</h2><p>ServeFlow is a multi-tenant platform for hospitality businesses that need their operational work to stay connected across roles.</p></div><ul className="lp-benefit-list">
        {["Keep service, orders, teams, and stock connected.", "Give each role a focused workspace for its daily work.", "Create a clearer handoff from guest order to kitchen and service."].map((benefit) => <li key={benefit}><UsersRound aria-hidden="true" size={20}/>{benefit}</li>)}
      </ul></div></section>
    </main>
    <PublicSiteFooter />
  </div>;
}
