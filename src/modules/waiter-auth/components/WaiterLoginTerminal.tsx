import type { KeyboardEvent } from "react";
import type { WaiterTerminalContext, WaiterTerminalProfile } from "../types";

export function RestaurantHeader({
  restaurant,
  now,
  online,
}: {
  restaurant: WaiterTerminalContext;
  now: Date;
  online: boolean;
}) {
  const date = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
  const shift = now.getHours() < 12 ? "Morning Shift" : now.getHours() < 17 ? "Afternoon Shift" : "Evening Shift";

  return (
    <header className="wlt-header">
      <div className="wlt-brand">
        <img src="/serveflowlogo.png" alt="ServeFlow" />
        <span className="wlt-divider" aria-hidden="true" />
        <div>
          <strong>{restaurant.name}</strong>
          <span>{date}</span>
        </div>
      </div>
      <div className="wlt-terminal-status">
        <div className="wlt-shift"><span>{shift}</span><strong>{time}</strong></div>
        <ConnectionStatus online={online} />
      </div>
    </header>
  );
}

export function ConnectionStatus({ online }: { online: boolean }) {
  return (
    <div className={`wlt-connection ${online ? "is-online" : "is-offline"}`} role="status">
      <span aria-hidden="true" /> {online ? "Online" : "Offline"}
    </div>
  );
}

export function SearchWaiter({
  value,
  onChange,
  onResolve,
  busy,
}: {
  value: string;
  onChange: (value: string) => void;
  onResolve: () => void;
  busy: boolean;
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      onResolve();
    }
  }
  return (
    <div className="wlt-search">
      <span aria-hidden="true">⌕</span>
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search by name or employee ID"
        aria-label="Search waiter by name or employee ID"
      />
      <button type="button" onClick={onResolve} disabled={busy || !value.trim()}>
        {busy ? "Finding…" : "Find"}
      </button>
    </div>
  );
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export function WaiterCard({ profile, onSelect }: { profile: WaiterTerminalProfile; onSelect: () => void }) {
  return (
    <button type="button" className="wlt-waiter-card" onClick={onSelect}>
      <span className="wlt-avatar" aria-hidden="true">{initials(profile.displayName)}</span>
      <strong>{profile.displayName}</strong>
      <span>{profile.role}</span>
      <small>{profile.employeeId}{profile.shift ? ` · ${profile.shift}` : ""}</small>
    </button>
  );
}

export function WaiterGrid({ profiles, onSelect }: { profiles: WaiterTerminalProfile[]; onSelect: (profile: WaiterTerminalProfile) => void }) {
  return (
    <div className="wlt-grid" aria-label="Waiters on this terminal">
      {profiles.map((profile) => <WaiterCard key={profile.staffId} profile={profile} onSelect={() => onSelect(profile)} />)}
    </div>
  );
}

export function PinIndicator({ length }: { length: number }) {
  return (
    <div className="wlt-pin-indicator" aria-label={`${length} PIN digits entered`}>
      {Array.from({ length: 4 }, (_, index) => <span key={index} className={index < length ? "is-filled" : ""} />)}
    </div>
  );
}

export function PinPad({
  onDigit,
  onBackspace,
  onSubmit,
  disabled,
}: {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onSubmit: () => void;
  disabled: boolean;
}) {
  const keys = ["7", "8", "9", "4", "5", "6", "1", "2", "3"];
  return (
    <div className="wlt-pin-pad" aria-label="Numeric PIN pad">
      {keys.map((key) => <button type="button" key={key} onClick={() => onDigit(key)} disabled={disabled}>{key}</button>)}
      <button type="button" className="is-secondary" onClick={onBackspace} disabled={disabled} aria-label="Delete last digit">⌫</button>
      <button type="button" onClick={() => onDigit("0")} disabled={disabled}>0</button>
      <button type="button" className="is-submit" onClick={onSubmit} disabled={disabled} aria-label="Start working">✓</button>
    </div>
  );
}
