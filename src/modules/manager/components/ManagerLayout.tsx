import { type ReactNode, useEffect, useState } from "react";
import { signOutStaff } from "../../staff-auth/services/staffAuthService";
import "../styles/managerLayout.css";

type Props = {
  restaurantName: string;
  managerName: string;
  section: string;
  children: ReactNode;
};

const MANAGER_NAV = [
  { key: "dashboard", label: "Overview", href: "/manager/dashboard", icon: "OV" },
  { key: "tables", label: "Operations Center", href: "/manager/tables", icon: "OP" },
  { key: "kitchen", label: "Kitchen", href: "/manager/kitchen", icon: "KI" },
  { key: "staff", label: "Staff", href: "/manager/staff", icon: "ST" },
  { key: "customers", label: "Customers", href: "/manager/customers", icon: "CU" },
  { key: "reports", label: "Reports", href: "/manager/reports", icon: "RP" },
  { key: "ai", label: "AI Advisor", href: "/manager/ai", icon: "AI" },
];

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "SF";
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" }).format(value);
}

function formatTime(value: Date) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(value);
}

export function ManagerLayout({ restaurantName, managerName, section, children }: Props) {
  const [now, setNow] = useState(() => new Date());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const activeSection = section === "cashier" || section === "tables" ? "tables" : section;

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(intervalId);
  }, []);

  function navigate(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    event.preventDefault();
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
          <strong>Serveflow</strong>
          <span>v2.1.0 Manager Terminal</span>
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
          <div className="ml-shift-card">
            <small>Current shift</small>
            <strong>Active Shift</strong>
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
          <label className="ml-search">
            <span>Search</span>
            <input placeholder="Search operations..." />
          </label>
          <div className="ml-header-meta">
            <div className="ml-clock">
              <strong>{formatTime(now)}</strong>
              <span>{formatDate(now)}</span>
            </div>
            <span className="ml-shift">Active Shift</span>
            <button className="ml-notification" type="button" aria-label="Notifications"><span>0</span></button>
            <button className="ml-menu-button" type="button" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}>Menu</button>
            <div className="ml-profile">
              <span>{initials(managerName)}</span>
              <strong>{managerName}</strong>
            </div>
          </div>
        </header>
        <div className="ml-content">{children}</div>
      </section>
    </main>
  );
}
