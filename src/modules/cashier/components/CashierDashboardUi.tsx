import type { ReactNode } from "react";

export type CashierIconName =
  | "order"
  | "bill"
  | "active"
  | "collection"
  | "cash"
  | "card"
  | "digital"
  | "due"
  | "paid"
  | "completed"
  | "bell"
  | "clock"
  | "terminal"
  | "drawer"
  | "user"
  | "search"
  | "cancel"
  | "print"
  | "close"
  | "door"
  | "logout";

export function CashierIcon({ name }: { name: CashierIconName }) {
  const paths: Record<CashierIconName, ReactNode> = {
    order: <><path d="M12 5v14M5 12h14"/><rect x="3" y="3" width="18" height="18" rx="4"/></>,
    bill: <><path d="M7 3h10a2 2 0 0 1 2 2v16l-3-2-4 2-4-2-3 2V5a2 2 0 0 1 2-2Z"/><path d="M8 8h8M8 12h6"/></>,
    active: <><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M12 11h4M12 16h4M8 11h.01M8 16h.01"/></>,
    collection: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    cash: <><rect x="3" y="6" width="18" height="13" rx="2"/><circle cx="12" cy="12.5" r="3"/><path d="M7 9h.01M17 16h.01"/></>,
    card: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/></>,
    digital: <><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4M9 6h6"/></>,
    due: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    paid: <><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></>,
    completed: <><path d="M5 3h14v18H5z"/><path d="m8 12 2 2 5-5"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    terminal: <><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 22h8M12 18v4"/></>,
    drawer: <><path d="M4 8h16v11H4zM6 4h12l2 4H4z"/><path d="M10 13h4"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    cancel: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 9 6 6m0-6-6 6"/></>,
    print: <><path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v7H7z"/></>,
    close: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/></>,
    door: <><path d="M13 4h6a1 1 0 0 1 1 1v15H4V5a1 1 0 0 1 1-1h4"/><path d="M9 2h4v18H9zM11 11h.01"/></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/></>,
  };

  return (
    <svg className="cd-outline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export function CashierMetricCard({
  label,
  value,
  detail,
  tone = "default",
  icon,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "default" | "warning" | "success";
  onClick?: () => void;
  icon?: CashierIconName;
}) {
  const currencyValue = value.match(/^([A-Za-z]{3}|[^\d\s.,]+)\s*(\d.*)$/);

  return (
    <article className={`cd-kpi-card ${tone}`} aria-label={`${label}: ${value}`} tabIndex={0}>
      {icon ? <span className="cd-kpi-icon"><CashierIcon name={icon} /></span> : null}
      <div className="cd-kpi-label">{label}</div>
      <div className="cd-kpi-value">
        {currencyValue ? <span className="cd-kpi-currency">{currencyValue[1]}</span> : null}
        <span className="cd-kpi-amount">{currencyValue?.[2] ?? value}</span>
      </div>
      {detail ? <div className="cd-kpi-detail">{detail}</div> : null}
    </article>
  );
}

export function CashierTopBar({
  restaurantName,
  cashierName,
  shiftActive,
  shiftDuration,
  date,
  time,
  hasNotification,
  reconnecting,
  onNotifications,
  onShiftAction,
  onSignOut,
  searchValue,
  onSearchChange,
}: {
  restaurantName: string;
  cashierName: string;
  shiftActive: boolean;
  shiftDuration: string;
  date: string;
  time: string;
  hasNotification: boolean;
  reconnecting: boolean;
  onNotifications: () => void;
  onShiftAction: () => void;
  onSignOut: () => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
}) {
  return (
    <header className="cd-header">
      {reconnecting ? <div role="status" className="cd-realtime-state">Realtime reconnecting...</div> : null}
      <div className="cd-header-left">
        <div className="cd-logo" aria-hidden="true">S</div>
        <div className="cd-header-info">
          <div className="cd-brand-name">ServeFlow</div>
          <div className="cd-restaurant-name">{restaurantName}</div>
        </div>
      </div>
      <label className="cd-header-search">
        <span className="cd-search-icon"><CashierIcon name="search" /></span>
        <input
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search table, customer, invoice or phone..."
          aria-label="Search by table, customer, invoice, order number, or phone number"
        />
        <kbd>Ctrl K</kbd>
      </label>
      <div className="cd-header-right">
        <div className="cd-header-shift-time">
          <CashierIcon name="clock" />
          <span>Shift Duration<strong>{shiftDuration}</strong></span>
        </div>
        <div className="cd-terminal-info" aria-label="Terminal status">
          <CashierIcon name="terminal" />
          <span>Terminal</span><strong>Cashier POS</strong><i>Online</i>
        </div>
        <button type="button" className="cd-icon-btn" aria-label={hasNotification ? "View new notifications" : "Notifications"} onClick={onNotifications}>
          <CashierIcon name="bell" />
          {hasNotification ? <span className="cd-notif-dot" /> : null}
        </button>
        <div className="cd-cashier-avatar" aria-hidden="true">{cashierName.charAt(0).toUpperCase()}</div>
        <div className="cd-header-cashier">
          <strong>{cashierName}</strong>
          <span>Cashier · {shiftActive ? "Active shift" : "Shift closed"}</span>
        </div>
        <div className="cd-header-datetime" aria-label={`${date}, ${time}`}>
          <div className="cd-header-time">{time}</div>
          <div className="cd-header-date">{date}</div>
        </div>
        <button type="button" className="cd-header-shift-btn" onClick={onShiftAction}>
          <CashierIcon name="door" />
          {shiftActive ? "Close Shift" : "Open Shift"}
        </button>
        <button type="button" className="cd-signout-btn" onClick={onSignOut}>
          <CashierIcon name="logout" /> <span>Sign Out</span>
        </button>
      </div>
    </header>
  );
}
