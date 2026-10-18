import { useState } from "react";
import { Activity, ArrowUpRight, Bell, Building2, ChevronDown, CreditCard, FileCheck2, LayoutDashboard, ShieldCheck, Users } from "lucide-react";
import { metric, type AdminResult, type AdminSection } from "./platformAdminService";

type LinkFor = (section: AdminSection) => string;
export function contractTiming(starts: unknown, ends: unknown, asOf: string): string {
  if (typeof starts !== "string" || typeof ends !== "string") return "Unavailable";
  const start = Date.parse(starts), end = Date.parse(ends), now = Date.parse(asOf);
  if (![start, end, now].every(Number.isFinite) || end <= start) return "Unavailable";
  if (now < start) return "Upcoming term";
  if (now >= end) return "Term ended";
  return end - now <= 30 * 86400000 ? "Ends within 30 days" : "Within term";
}
export const pageTitles: Record<AdminSection, string> = {
  overview: "Platform overview", applications: "Applications", businesses: "Businesses", users: "Users & Access",
  contracts: "Contracts & Trials", payments: "Payments & Renewals", notifications: "Notifications", "system-health": "System Health",
  diagnostics: "Errors & Diagnostics", integrations: "Integrations", backups: "Backups & Recovery", "audit-logs": "Audit Logs",
  administrators: "Administrators & Access", security: "Security & Recovery",
};
export const descriptions: Record<AdminSection, string> = {
  overview: "Monitor businesses, subscriptions, payments, and platform health.",
  applications: "Review new business applications and keep each decision traceable.",
  businesses: "Your hospitality business directory, with ownership and reviewed classification.",
  users: "Understand who belongs to each business and review invitation records.",
  contracts: "Review subscription terms, trial dates, and upcoming renewal work.",
  payments: "Review submitted subscription payments. Evidence is not confirmation.",
  notifications: "Track contract reminders and the evidence of their delivery.",
  "system-health": "See what has been checked and where service visibility is still missing.",
  diagnostics: "Investigate reported administration issues without exposing private error details.",
  integrations: "Review service connections and their verification status.",
  backups: "Understand backup evidence before planning any recovery operation.",
  "audit-logs": "Trace platform decisions by actor, target, date, and outcome.",
  administrators: "Review privately authorized platform identities and their access scope.",
  security: "Review the safeguards protecting your platform and recovery process.",
};
const operations: AdminSection[] = ["system-health", "diagnostics", "integrations", "backups", "audit-logs", "administrators", "security"];

export function WorkspaceNavigation({ section, pathFor, onNavigate }: { section: AdminSection; pathFor: LinkFor; onNavigate: () => void }) {
  const [operationsOpen, setOperationsOpen] = useState(operations.includes(section));
  const main = [
    ["overview", "Overview", LayoutDashboard], ["applications", "Applications", FileCheck2], ["businesses", "Businesses", Building2],
    ["contracts", "Subscriptions & Payments", CreditCard], ["users", "Users & Access", Users], ["notifications", "Notifications", Bell],
  ] as const;
  return <nav aria-label="Platform administration">
    <p className="pa-nav-label">Workspace</p>
    {main.map(([key, label, Icon]) => <a key={key} title={label} href={pathFor(key)} onClick={onNavigate} aria-current={section === key || key === "contracts" && section === "payments" ? "page" : undefined}><Icon size={19} aria-hidden="true" /><span>{label}</span></a>)}
    <p className="pa-nav-label">Platform operations</p>
    <button className="pa-nav-group" title="System & Security" aria-expanded={operationsOpen} aria-controls="pa-operations" onClick={() => setOperationsOpen(value => !value)}><ShieldCheck size={19} aria-hidden="true" /><span>System & Security</span><ChevronDown size={15} aria-hidden="true" /></button>
    {operationsOpen && <div id="pa-operations" className="pa-subnav">{operations.map(key => <a key={key} title={pageTitles[key]} href={pathFor(key)} onClick={onNavigate} aria-current={section === key ? "page" : undefined}><span>{pageTitles[key]}</span></a>)}</div>}
  </nav>;
}

export function WorkspaceTabs({ section, pathFor }: { section: AdminSection; pathFor: LinkFor }) {
  const tabs: AdminSection[] = ["contracts", "payments"].includes(section) ? ["contracts", "payments"] : section === "users" ? ["users", "administrators"] : operations.includes(section) ? operations : [];
  if (!tabs.length) return null;
  return <nav className="pa-section-tabs" aria-label="Workspace sections">{tabs.map(key => <a key={key} href={pathFor(key)} aria-current={section === key ? "page" : undefined}>{pageTitles[key]}</a>)}</nav>;
}

export function statusTone(value: unknown): "positive" | "negative" | "attention" | "neutral" {
  const text = value == null ? "Unavailable" : typeof value === "boolean" ? value ? "Yes" : "No" : String(value).replace(/_/g, " ");
  return /^(approved|succeeded|live|healthy|active|yes)$/i.test(text) ? "positive" : /^(rejected|failed|no)$/i.test(text) ? "negative" : /^(pending|needs review)$/i.test(text) ? "attention" : "neutral";
}
export function StatusBadge({ value }: { value: unknown }) {
  const text = value == null ? "Unavailable" : typeof value === "boolean" ? value ? "Yes" : "No" : String(value).replace(/_/g, " ");
  const tone = statusTone(value);
  return <span className={`pa-badge pa-badge-${tone}`}>{text}</span>;
}

export function PlatformOverview({ data, pathFor, synthetic }: { data: AdminResult; pathFor: LinkFor; synthetic: boolean }) {
  // Unsupported production fields stay unavailable; no list length or approved-count substitution.
  const metrics = [
    ["totalBusinesses", "Total businesses", "Your complete business directory", "businesses", Building2],
    ["operationalBusinesses", "Active businesses", "Verified operational access", "businesses", Activity],
    ["pendingApplications", "Applications awaiting review", "New businesses requesting access", "applications", FileCheck2],
    ["expiringContracts", "Contracts expiring soon", "Renewals due within 30 days", "contracts", CreditCard],
    ["pendingPayments", "Payments awaiting review", "Submitted evidence to review", "payments", CreditCard],
    ["activeTrials", "Active trials", "Businesses in their trial period", "contracts", Users],
  ] as const;
  const queues = [
    ["pendingApplications", "Applications need a decision", "Review business details before approving or rejecting.", "applications"],
    ["pendingPayments", "Payment evidence needs review", "Check submitted evidence; no payment is confirmed automatically.", "payments"],
    ["expiringContracts", "Upcoming contract renewals", "Review terms and plan the next conversation.", "contracts"],
  ] as const;
  const activity = synthetic && Array.isArray(data.previewActivity) ? data.previewActivity as Array<{ actor: string; action: string; target: string; at: string }> : null;
  return <>
    <div className="pa-metrics">{metrics.map(([key, label, hint, destination, Icon]) => <section key={key}><div className="pa-metric-label"><h2>{label}</h2><Icon size={17} aria-hidden="true" /></div><p className={metric(data[key]) === "Unavailable" ? "pa-value-unavailable" : ""}>{metric(data[key])}</p><div className="pa-metric-footer"><span>{typeof data[key] === "number" ? hint : "Verified data not available"}</span><a href={pathFor(destination)} aria-label={`View ${label.toLowerCase()}`}><ArrowUpRight size={18} aria-hidden="true" /></a></div></section>)}</div>
    <div className="pa-overview-grid">
      <section className="pa-panel pa-attention"><div className="pa-panel-heading"><div><p className="pa-eyebrow">Your work queue</p><h2>Needs your attention</h2></div><FileCheck2 size={20} aria-hidden="true" /></div>
        {queues.map(([key, label, hint, destination]) => <a className="pa-attention-row" href={`${pathFor(destination)}${destination === "applications" || destination === "payments" ? "?status=pending" : ""}`} key={key}><span className="pa-queue-count">{typeof data[key] === "number" ? metric(data[key]) : "—"}</span><span><strong>{label}</strong><small>{typeof data[key] === "number" ? data[key] === 0 ? "No outstanding items in this queue." : hint : "This queue is not yet available."}</small></span><ArrowUpRight size={18} aria-hidden="true" /></a>)}
        <a className="pa-health-link" href={pathFor("system-health")}><ShieldCheck size={18} aria-hidden="true" /><span>Platform health & security<small>Open service checks · overall status not verified</small></span><ArrowUpRight size={18} aria-hidden="true" /></a>
      </section>
      <section className="pa-panel"><div className="pa-panel-heading"><div><p className="pa-eyebrow">A clear record</p><h2>Recent platform activity</h2></div><Activity size={20} aria-hidden="true" /></div>
        {activity ? <ul className="pa-activity">{activity.map((event, index) => <li key={index}><span className="pa-activity-dot" /><div><strong>{event.action}</strong><p>{event.target}</p><small>{event.actor} · {new Date(event.at).toLocaleString()}</small></div></li>)}</ul> : <div className="pa-empty"><Activity size={24} aria-hidden="true" /><h3>Activity summary unavailable</h3><p>Open Audit Logs to review the available platform records.</p></div>}
        <a className="pa-text-link" href={pathFor("audit-logs")}>View audit logs <ArrowUpRight size={16} aria-hidden="true" /></a>
      </section>
    </div>
    <section className="pa-panel pa-subscription-summary"><div><p className="pa-eyebrow">Subscription portfolio</p><h2>Contracts & business continuity</h2><p>Review terms before renewal. Expiry never means deleting business history.</p></div><div><span>Active annual contracts</span><strong>{metric(data.activeContracts)}</strong></div><div><span>Expired contracts</span><strong>{metric(data.expiredContracts)}</strong></div><a className="pa-text-link" href={pathFor("contracts")}>Review contracts <ArrowUpRight size={16} aria-hidden="true" /></a></section>
  </>;
}

