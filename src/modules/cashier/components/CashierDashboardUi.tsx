export function CashierMetricCard({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "default" | "warning" | "success";
}) {
  return (
    <div className={`cd-kpi-card ${tone}`}>
      <div className="cd-kpi-label">{label}</div>
      <div className="cd-kpi-value">{value}</div>
      {detail ? <div className="cd-kpi-change neutral">{detail}</div> : null}
    </div>
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
}) {
  return (
    <header className="cd-header">
      {reconnecting ? (
        <div role="status" className="cd-realtime-state">
          Realtime reconnecting...
        </div>
      ) : null}
      <div className="cd-header-left">
        <div className="cd-logo" aria-hidden="true">S</div>
        <div className="cd-header-info">
          <div className="cd-brand-name">ServeFlow</div>
          <div className="cd-restaurant-name">{restaurantName}</div>
        </div>
      </div>
      <div className="cd-header-search" aria-hidden="true">
        <span className="cd-search-icon">⌕</span>
        <span>Search orders, tables, invoice #...</span>
      </div>
      <div className="cd-header-right">
        <div className="cd-cashier-avatar" aria-hidden="true">
          {cashierName.charAt(0).toUpperCase()}
        </div>
        <div className="cd-header-cashier">
          <strong>{cashierName}</strong>
          <span>Cashier · {shiftActive ? "Active shift" : "Shift closed"}</span>
        </div>
        <div className="cd-header-shift-time">
          <span>Shift Time</span>
          <strong>{shiftDuration}</strong>
        </div>
        <div className="cd-header-datetime">
          <div className="cd-header-time">{time}</div>
          <div className="cd-header-date">{date}</div>
        </div>
        <button
          type="button"
          className="cd-icon-btn"
          aria-label={hasNotification ? "View new notifications" : "Notifications"}
          onClick={onNotifications}
        >
          <span aria-hidden="true">!</span>
          {hasNotification ? <span className="cd-notif-dot" /> : null}
        </button>
        <button type="button" className="cd-header-shift-btn" onClick={onShiftAction}>
          {shiftActive ? "Close Shift" : "Open Shift"}
        </button>
        <button type="button" className="cd-signout-btn" onClick={onSignOut}>
          Sign Out
        </button>
      </div>
    </header>
  );
}
