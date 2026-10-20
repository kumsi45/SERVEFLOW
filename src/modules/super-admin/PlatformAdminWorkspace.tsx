import { useEffect, useState } from "react";
import { Bell, Building2, CreditCard, FileCheck2, LayoutDashboard, Users, ScrollText, HeartPulse, Cable, DatabaseBackup, ListFilter, Shield, UserCog, FileClock } from "lucide-react";
import type { AdminResult, AdminSection } from "./platformAdminService";
import type { AdminDataSource } from "./platformAdminData";
import { ActivityFeed, AttentionList, ErrorState, HealthList, Skeleton, StatTile } from "./PlatformAdminUI";

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

export function WorkspaceNavigation({ section, pathFor, onNavigate, counts }: { section: AdminSection; pathFor: LinkFor; onNavigate: () => void; counts?: { applications: number | null; payments: number | null } }) {
  const main = [
    ["overview", "Overview", LayoutDashboard], ["applications", "Applications", FileCheck2], ["businesses", "Businesses", Building2],
    ["contracts", "Contracts", FileClock], ["payments", "Payments", CreditCard], ["users", "Users & access", Users], ["notifications", "Notifications", Bell],
  ] as const;
  const system = [
    ["system-health", "System health", HeartPulse], ["diagnostics", "Diagnostics", ListFilter], ["integrations", "Integrations", Cable],
    ["backups", "Backups", DatabaseBackup], ["audit-logs", "Audit logs", ScrollText], ["administrators", "Administrators", UserCog], ["security", "Security", Shield],
  ] as const;
  return <nav aria-label="Platform administration">
    <p className="pa-nav-label">Workspace</p>
    {main.map(([key, label, Icon]) => <a key={key} title={label} href={pathFor(key)} onClick={onNavigate} aria-current={section === key ? "page" : undefined}><Icon size={20} aria-hidden="true" /><span>{label}</span>{(key === "applications" || key === "payments") && typeof counts?.[key] === "number" && counts[key] > 0 && <span className="pa-nav-count" aria-label={`${counts[key]} pending`}>{counts[key] > 99 ? "99+" : counts[key]}</span>}</a>)}
    <p className="pa-nav-label">System</p>
    {system.map(([key, label, Icon]) => <a key={key} title={label} href={pathFor(key)} onClick={onNavigate} aria-current={section === key ? "page" : undefined}><Icon size={20} aria-hidden="true" /><span>{label}</span></a>)}
  </nav>;
}

export function WorkspaceTabs({ section, pathFor }: { section: AdminSection; pathFor: LinkFor }) {
  const tabs: AdminSection[] = ["contracts", "payments"].includes(section) ? ["contracts", "payments"] : section === "users" ? ["users", "administrators"] : operations.includes(section) ? operations : [];
  if (!tabs.length) return null;
  return <nav className="pa-section-tabs" aria-label="Workspace sections">{tabs.map(key => <a key={key} href={pathFor(key)} aria-current={section === key ? "page" : undefined}>{({ contracts: "Contracts", payments: "Payments", users: "Users", administrators: "Administrators" } as Partial<Record<AdminSection, string>>)[key] ?? pageTitles[key]}</a>)}</nav>;
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

export function PlatformOverview({ data, pathFor, synthetic, dataSource }: { data: AdminResult; pathFor: LinkFor; synthetic: boolean; dataSource: AdminDataSource }) {
  const [health, setHealth] = useState<AdminResult | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [healthLoading, setHealthLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setHealthLoading(true); setHealthError(false);
    void dataSource.read({ resource: "system-health", search: "", status: "", cursor: null, from: "", through: "" }).then(result => { if (active) setHealth(result); }).catch(() => { if (active) setHealthError(true); }).finally(() => { if (active) setHealthLoading(false); });
    return () => { active = false; };
  }, [dataSource, retry]);
  const count = (key: string) => typeof data[key] === "number" ? data[key] as number : null;
  const activity = synthetic && Array.isArray(data.previewActivity) ? (data.previewActivity as Array<{ actor: string; action: string; target: string; at: string }>).map(item => ({ action: item.action, subject: item.target, actor: item.actor, at: item.at })) : null;
  const healthValue = (value: unknown) => value === "healthy" || value === "failed" ? value : null;
  return <div className="pa-overview">
    <AttentionList items={[
      { label: "Applications to decide", count: count("pendingApplications"), href: `${pathFor("applications")}?status=pending` },
      { label: "Payment evidence to review", count: count("pendingPayments"), href: `${pathFor("payments")}?status=pending` },
      { label: "Contracts expiring within 30 days", count: count("expiringContracts"), href: pathFor("contracts") },
    ]} />
    <div className="pa-overview-stats"><StatTile label="Total businesses" value={count("totalBusinesses")} /><StatTile label="Active businesses" value={count("operationalBusinesses")} /><StatTile label="Active trials" value={count("activeTrials")} /></div>
    <div className="pa-overview-lower"><div><ActivityFeed items={activity} /><a className="pa-overview-link" href={pathFor("audit-logs")}>View audit logs</a></div>{healthLoading ? <section className="pa-ui-health"><h2>Platform health</h2><Skeleton /></section> : healthError || !health ? <ErrorState message="Platform health could not be loaded." retry={() => setRetry(value => value + 1)} /> : <HealthList items={[
      { label: "Database", status: healthValue((health.database as Record<string, unknown> | undefined)?.status) },
      { label: "Sign-in service", status: healthValue(health.auth) },
      { label: "File storage", status: healthValue(health.storage) },
      { label: "Live updates", status: healthValue(health.realtime) },
      { label: "Background services", status: healthValue(health.edgeFunctions) },
    ]} />}</div>
  </div>;
}

