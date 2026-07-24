import { type ReactNode, useEffect, useState } from "react";
import { signOutStaff } from "../../staff-auth/services/staffAuthService";
import "../styles/managerLayout.css";

type Props = {
  restaurantId: string;
  restaurantName: string;
  managerName: string;
  section: string;
  children: ReactNode;
};

const MANAGER_NAV = [
  { key: "dashboard", label: "Dashboard", mobileLabel: "Overview", href: "/manager/dashboard", icon: "⌂" },
  { key: "tables", label: "Operations", mobileLabel: "Operations", href: "/manager/tables", icon: "◎" },
  { key: "kitchen", label: "Kitchen", mobileLabel: "Kitchen", href: "/manager/kitchen", icon: "◫" },
  { key: "staff", label: "Staff", mobileLabel: "Staff", href: "/manager/staff", icon: "♙" },
  { key: "customers", label: "Guests", mobileLabel: "Guests", href: "/manager/customers", icon: "♡" },
  { key: "reports", label: "Reports", mobileLabel: "Reports", href: "/manager/reports", icon: "▥" },
  { key: "intelligence", label: "Intelligence", mobileLabel: "Intelligence", href: "/manager/intelligence", icon: "◆" },
  { key: "ai", label: "AI", mobileLabel: "AI", href: "/manager/ai", icon: "✦" },
  { key: "inventory", label: "Inventory", mobileLabel: "Inventory", href: "/inventory/dashboard", icon: "IN" },
];

const MOBILE_NAV = MANAGER_NAV.filter((item) => ["dashboard", "tables", "kitchen", "staff"].includes(item.key));

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "SF";
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" }).format(value);
}

function formatTime(value: Date) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(value);
}

export function ManagerLayout({ restaurantId, restaurantName, managerName, section, children }: Props) {
  const [now, setNow] = useState(() => new Date());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const activeSection = section === "cashier" || section === "tables" ? "tables" : section;

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(intervalId);
  }, []);

  function navigate(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    event.preventDefault();
    if (href.startsWith("/inventory/")) {
      window.sessionStorage.setItem("serveflow.active-restaurant:inventory", restaurantId);
    }
    window.history.pushState({}, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
    setSidebarOpen(false);
  }

  async function logout() {
    await signOutStaff();
    window.location.replace("/staff-login");
  }

  return (
    <main className="ml-shell">
      <aside className={`ml-sidebar ${sidebarOpen ? "is-open" : ""}`} aria-label="Manager navigation">
        <div className="ml-sidebar-brand">
          <strong>ServeFlow</strong>
          <span>Manager operations</span>
        </div>
        <nav className="ml-sidebar-nav">
          {MANAGER_NAV.map((item) => (
            <a
              className={activeSection === item.key ? "is-active" : ""}
              href={item.href}
              key={item.key}
              onClick={(event) => navigate(event, item.href)}
            >
              <span>{item.icon}</span>
              {item.label}
            </a>
          ))}
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
      {sidebarOpen && <button className="ml-sidebar-scrim" type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}

      <section className="ml-workspace">
        <header className="ml-header">
          <div className="ml-header-left">
            <div className="ml-logo" aria-hidden="true"><span>{initials(restaurantName)}</span></div>
            <div className="ml-restaurant-title">
              <strong>{restaurantName}</strong>
            </div>
          </div>
          <div className="ml-header-context"><span>Manager workspace</span><strong>{MANAGER_NAV.find((item) => item.key === activeSection)?.label ?? "Operations"}</strong></div>
          <div className="ml-header-meta">
            <div className="ml-clock">
              <strong>{formatTime(now)}</strong>
              <span>{formatDate(now)}</span>
            </div>
            <button className="ml-menu-button" type="button" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}>Menu</button>
            <div className="ml-profile">
              <span>{initials(managerName)}</span>
              <strong>{managerName}</strong>
            </div>
          </div>
        </header>
        <div className="ml-content">{children}</div>
        <nav className="ml-bottom-nav" aria-label="Primary mobile navigation">
          {MOBILE_NAV.map((item) => <a key={item.key} className={activeSection === item.key ? "is-active" : ""} href={item.href} onClick={(event) => navigate(event, item.href)}><span>{item.icon}</span>{item.mobileLabel}</a>)}
        </nav>
      </section>
    </main>
  );
}
