import { useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { ChevronRight, RefreshCw, Search, X } from "lucide-react";
import { useModalFocus } from "../../core/accessibility/useModalFocus";

type ButtonKind = "primary" | "secondary" | "destructive" | "ghost" | "icon";
export function Button({ kind = "secondary", loading = false, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: ButtonKind; loading?: boolean }) {
  return <button {...props} type={props.type ?? "button"} className={`pa-ui-button pa-ui-${kind} ${props.className ?? ""}`} disabled={props.disabled || loading} aria-busy={loading || undefined}>{loading ? "Working…" : children}</button>;
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "positive" | "attention" | "negative"; children: ReactNode }) {
  return <span className={`pa-badge pa-badge-${tone}`}>{children}</span>;
}

export function FilterChip({ active, count, children, onClick }: { active: boolean; count?: number | null; children: ReactNode; onClick: () => void }) {
  return <button type="button" className="pa-filter-chip" aria-pressed={active} onClick={onClick}>{children}{typeof count === "number" && <span>{count}</span>}</button>;
}

export function Input({ label, id, error, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string; error?: string }) {
  return <label htmlFor={id} className="pa-field">{label}<input {...props} id={id} aria-invalid={Boolean(error) || undefined} aria-describedby={error ? `${id}-error` : undefined} />{error && <span role="alert" id={`${id}-error`}>{error}</span>}</label>;
}

export function SearchInput({ id, label = "Search", ...props }: InputHTMLAttributes<HTMLInputElement> & { id: string; label?: string }) {
  return <label className="pa-search" htmlFor={id}><Search size={18} aria-hidden="true" /><span className="pa-visually-hidden">{label}</span><input {...props} id={id} type="search" aria-label={label} /></label>;
}

export function Select({ label, id, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; id: string }) {
  return <label className="pa-field" htmlFor={id}>{label}<select {...props} id={id}>{children}</select></label>;
}

export function RefreshButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) { return <Button kind="icon" className="pa-toolbar-refresh" aria-label="Refresh" title="Refresh" onClick={onClick} disabled={disabled}><RefreshCw size={17} aria-hidden="true" /></Button>; }

export type TableColumn<T> = { key: string; label: string; render: (row: T) => ReactNode; mobile?: boolean; sort?: "ascending" | "descending" };
export function DataTable<T extends { id: string }>({ label, columns, rows, onOpen }: { label: string; columns: TableColumn<T>[]; rows: T[]; onOpen?: (row: T) => void }) {
  return <div className="pa-data-table" role="region" aria-label={label}><table><thead><tr>{columns.map(column => <th scope="col" key={column.key} aria-sort={column.sort}>{column.label}{column.sort && <span className="pa-sort-arrow" aria-hidden="true">↓</span>}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id} tabIndex={onOpen ? 0 : undefined} onClick={onOpen ? () => onOpen(row) : undefined} onKeyDown={onOpen ? event => { if (event.target !== event.currentTarget) return; if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); const sibling = event.key === "ArrowDown" ? event.currentTarget.nextElementSibling : event.currentTarget.previousElementSibling; if (sibling instanceof HTMLElement) sibling.focus(); return; } if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(row); } } : undefined}>{columns.map(column => <td key={column.key} data-label={column.label} className={column.mobile === false ? "pa-mobile-hide" : undefined}>{column.render(row)}</td>)}</tr>)}</tbody></table></div>;
}

export function Pagination({ start, end, total, size, onSize, previous, next, previousLabel = "Previous" }: { start: number; end: number; total: number | null; size: number; onSize?: (value: number) => void; previous?: () => void; next?: () => void; previousLabel?: string }) {
  if (total !== null && total <= size) return null;
  return <nav className="pa-ui-pagination" aria-label="Pagination"><span>{start}-{end} of {total === null ? "more records" : total}</span>{onSize && <Select id="pa-page-size" label="Rows per page" value={size} onChange={event => onSize(Number(event.target.value))}><option value={25}>25</option><option value={50}>50</option></Select>}<Button disabled={!previous} onClick={previous}>{previousLabel}</Button><Button disabled={!next} onClick={next}>Next</Button></nav>;
}

export function Drawer({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(true, onClose, ref);
  return <div className="pa-dialog-backdrop"><aside className="pa-ui-drawer" role="dialog" aria-modal="true" aria-label={title} ref={ref}><header><h2>{title}</h2><Button kind="icon" aria-label="Close details" onClick={onClose}><X size={18} /></Button></header>{children}</aside></div>;
}

export function ConfirmDialog({ title, children, reason, onReason, reasonMin = 0, busy, onConfirm, onClose, destructive = false }: { title: string; children?: ReactNode; reason?: string; onReason?: (value: string) => void; reasonMin?: number; busy?: boolean; onConfirm: () => void; onClose: () => void; destructive?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(true, onClose, ref);
  return <div className="pa-dialog-backdrop"><section className="pa-dialog" role="dialog" aria-modal="true" aria-label={title} ref={ref}><h2>{title}</h2>{children}{onReason && <label className="pa-field">Reason<textarea value={reason ?? ""} minLength={reasonMin} onChange={event => onReason(event.target.value)} aria-describedby="pa-reason-hint" required /></label>}{onReason && reasonMin > 0 && <p id="pa-reason-hint" className="pa-small">At least {reasonMin} characters.</p>}<div className="pa-row-actions"><Button onClick={onClose} disabled={busy}>Cancel</Button><Button kind={destructive ? "destructive" : "primary"} onClick={onConfirm} loading={busy} disabled={Boolean(onReason && (reason ?? "").trim().length < reasonMin)}>Confirm</Button></div></section></div>;
}

export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  return <span className="pa-ui-tooltip" tabIndex={0} aria-label={text}>{children}<span role="tooltip">{text}</span></span>;
}

export function Breadcrumb({ items }: { items: Array<{ label: string; href?: string }> }) {
  return <nav className="pa-breadcrumb" aria-label="Breadcrumb"><ol>{items.map((item, index) => <li key={`${item.label}-${index}`}>{item.href ? <a href={item.href}>{item.label}</a> : <span aria-current="page">{item.label}</span>}{index < items.length - 1 && <ChevronRight size={14} aria-hidden="true" />}</li>)}</ol></nav>;
}

export function Tabs({ items }: { items: Array<{ label: string; active: boolean; onClick: () => void }> }) {
  return <div className="pa-ui-tabs" role="tablist">{items.map(item => <button type="button" role="tab" key={item.label} aria-selected={item.active} onClick={item.onClick}>{item.label}</button>)}</div>;
}

export function PageHeader({ title, meta, onRefresh, busy, updatedAt, actions }: { title: string; meta?: string; onRefresh?: () => void; busy?: boolean; updatedAt?: string; actions?: ReactNode }) {
  return <header className="pa-ui-page-header"><div><h1>{title}</h1>{meta && <p>{meta}</p>}</div><div>{updatedAt && <time dateTime={updatedAt}>Updated {new Date(updatedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</time>}{actions}{onRefresh && <Button kind="icon" aria-label="Refresh" title="Refresh" onClick={onRefresh} loading={busy}>↻</Button>}</div></header>;
}

export function StatTile({ label, value }: { label: string; value: number | null | undefined }) {
  return <div className="pa-ui-stat"><strong>{typeof value === "number" ? value.toLocaleString() : "Unavailable"}</strong><span>{label}</span></div>;
}

export function AttentionList({ items, empty = "All caught up" }: { items: Array<{ label: string; count: number | null; href: string }>; empty?: string }) {
  const shown = items.filter(item => item.count === null || item.count > 0);
  return <section className="pa-ui-attention"><h2>Needs attention</h2>{shown.length ? <ul>{shown.map(item => <li key={item.label}><a href={item.href}><Badge tone={item.count === null ? "neutral" : "attention"}>{item.count ?? "Unknown"}</Badge><span>{item.label}</span><ChevronRight size={18} aria-hidden="true" /></a></li>)}</ul> : <p>{empty}</p>}</section>;
}

export function ActivityFeed({ items }: { items: Array<{ action: string; subject: string; actor: string; at: string }> | null }) {
  const relative = (at: string) => {
    const elapsed = Date.now() - Date.parse(at);
    if (!Number.isFinite(elapsed)) return "Time unknown";
    const minutes = Math.round(elapsed / 60000);
    const unit: Intl.RelativeTimeFormatUnit = Math.abs(minutes) < 60 ? "minute" : Math.abs(minutes) < 1440 ? "hour" : "day";
    const value = unit === "minute" ? minutes : unit === "hour" ? Math.round(minutes / 60) : Math.round(minutes / 1440);
    return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(-value, unit);
  };
  return <section className="pa-ui-feed"><h2>Recent activity</h2>{items === null ? <p>Activity unavailable. Open Audit Logs for available records.</p> : items.length === 0 ? <p>No recent activity.</p> : <ol>{items.map((item, index) => <li key={`${item.at}-${index}`}><strong>{item.action}</strong><span>{item.subject}</span><small>{item.actor} · <time dateTime={item.at} title={new Date(item.at).toLocaleString()}>{relative(item.at)}</time></small></li>)}</ol>}</section>;
}

export function HealthList({ items }: { items: Array<{ label: string; status: string | null; checkedAt?: string | null }> }) {
  return <section className="pa-ui-health"><h2>Platform health</h2><ul>{items.map(item => <li key={item.label} data-status={item.status ?? "unknown"}><span>{item.label}</span><Badge tone={item.status === "healthy" ? "positive" : item.status === "failed" ? "negative" : "neutral"}>{item.status ?? "Unknown"}</Badge><small>{item.checkedAt ? new Date(item.checkedAt).toLocaleString() : "Not checked"}</small></li>)}</ul></section>;
}

export function EmptyState({ title, action }: { title: string; action?: ReactNode }) { return <div className="pa-ui-state"><h2>{title}</h2>{action}</div>; }
export function ErrorState({ message, retry }: { message: string; retry: () => void }) { return <div className="pa-ui-state" role="alert"><p>{message}</p><Button onClick={retry}>Try again</Button></div>; }
export function Skeleton({ count = 3 }: { count?: number }) { return <div className="pa-ui-skeleton" role="status" aria-label="Loading">{Array.from({ length: count }, (_, index) => <span key={index} />)}</div>; }
export function Toast({ message, tone = "neutral", onClose }: { message: string; tone?: "neutral" | "positive" | "negative"; onClose: () => void }) { return <div className={`pa-ui-toast pa-ui-toast-${tone}`} role={tone === "negative" ? "alert" : "status"}>{message}<Button kind="icon" aria-label="Dismiss message" onClick={onClose}><X size={16} /></Button></div>; }
export function BottomTabBar({ items }: { items: Array<{ label: string; ariaLabel?: string; href?: string; active: boolean; badge?: number; icon: ReactNode; onClick?: () => void }> }) { return <nav className="pa-bottom-tabs" aria-label="Primary navigation">{items.map(item => item.href ? <a key={item.label} href={item.href} aria-label={item.ariaLabel} aria-current={item.active ? "page" : undefined}>{item.icon}<span>{item.label}</span>{Boolean(item.badge) && <Badge tone="attention">{item.badge! > 99 ? "99+" : item.badge}</Badge>}</a> : <button key={item.label} type="button" onClick={item.onClick} aria-label={item.ariaLabel} aria-expanded={item.active}>{item.icon}<span>{item.label}</span></button>)}</nav>; }
export function AccountMenu({ children }: { children: ReactNode }) { return <div className="pa-ui-account">{children}</div>; }
export function DemoBanner() { return <div className="pa-demo-banner" role="note" title="Synthetic preview data">Demo data</div>; }
