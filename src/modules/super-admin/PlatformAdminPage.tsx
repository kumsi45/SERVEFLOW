import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, LogOut, Menu, ShieldCheck, X, PanelLeftClose, PanelLeftOpen, RefreshCw, SlidersHorizontal, Search } from "lucide-react";
import { useModalFocus } from "../../core/accessibility/useModalFocus";
import { createBrowserUuid } from "../../core/browser/createBrowserUuid";
import { getPlatformAdminClient } from "./platformAdminClient";
import { adminContext, recordAdminDiagnostic, safeAdminError, type AdminContext, type AdminCursor, type AdminResult, type AdminRow, type AdminSection } from "./platformAdminService";
import { privateAdminDataSource, type AdminDataSource, type AdminMutationRequest } from "./platformAdminData";
import { PublicThemeToggle } from "../landing/components/PublicThemeToggle";
import { WorkspaceNavigation, WorkspaceTabs, PlatformOverview, StatusBadge, contractTiming, pageTitles, descriptions } from "./PlatformAdminWorkspace";
import "./platformAdmin.css";

export type PlatformAdminPreviewConfig = {
  dataSource: AdminDataSource & { setMode?: (mode: "populated" | "loading" | "empty" | "error" | "partial" | "large") => void };
  pathFor: (section: AdminSection) => string;
};
type Props = { section: AdminSection | "login"; preview?: PlatformAdminPreviewConfig };
type Action = { kind: "classification" | "approved" | "rejected" | "payment-rejected" | "record-payment"; row?: AdminRow; requestId: string };
const display = (value: unknown): string => value === null || value === undefined ? "Unavailable" : typeof value === "boolean" ? value ? "Yes" : "No" : typeof value === "string" || typeof value === "number" ? String(value) : "—";
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "Unavailable";
const columns: Record<string, Array<[string, string]>> = {
  businesses: [["name", "Business"], ["slug", "Slug"], ["classification", "Classification"], ["owners", "Owner association"], ["entitlement", "Entitlement"], ["created_at", "Created"]],
  applications: [["business_name", "Business"], ["business_type", "Type"], ["contact_name", "Contact"], ["contact_email", "Email"], ["status", "Decision"], ["decision_reason", "Reason"], ["created_at", "Submitted"]],
  users: [["display_name", "Member"], ["business_name", "Business"], ["role", "Tenant role"], ["active", "Active"], ["created_at", "Created"]],
  invitations: [["business_name", "Business"], ["application_id", "Application"], ["delivery_status", "Delivery"], ["created_at", "Created"]],
  contracts: [["business_name", "Business"], ["kind", "Term"], ["starts_at", "Start"], ["ends_at", "End"], ["term_timing", "Term timing"]],
  payments: [["business_name", "Business"], ["amount", "Amount"], ["currency", "Currency"], ["channel", "Channel"], ["reference", "Reference"], ["paid_at", "Payment date"], ["status", "Review"], ["reason", "Reason"]],
  notifications: [["contract_id", "Contract"], ["milestone", "Days before expiry"], ["due_at", "Due"], ["status", "Delivery"]],
  "audit-logs": [["created_at", "Time"], ["actor_id", "Actor"], ["action", "Action"], ["target_id", "Target"], ["outcome", "Outcome"], ["reason", "Reason"], ["request_id", "Request"]],
  administrators: [["display_name", "Administrator"], ["id", "Auth identity"], ["active", "Active"], ["can_manage", "Manage"], ["can_sensitive", "Sensitive"], ["recovery_verified", "Recovery reviewed"]],
  diagnostics: [["created_at", "Time"], ["code", "Redacted category"], ["source", "Source"], ["environment", "Environment"], ["request_id", "Correlation"]],
};
const notes: Partial<Record<AdminSection, string>> = {
  applications: "Application intake is disabled pending approved applicant retention. Approval records a delivery-disabled invitation intent; it does not create an account, send email or activate a trial.",
  businesses: "Classification is a reviewed label, not a paid entitlement. Existing businesses remain unclassified until reviewed. Suspension and restoration are unavailable until server enforcement is complete.",
  users: "Tenant membership and platform administrator authorization are separate. Invitations cannot be sent, accepted or provisioned until the reviewed provider and provisioning workflow are enabled.",
  contracts: "Trials require a separate readiness authority. Annual terms are exactly 365 × 24 hours. Activation, renewals and expiry enforcement cutover are unavailable; existing dates and access are unchanged.",
  payments: "ServeFlow subscription reviews are separate from restaurant customer invoices. A recorded payment is unverified evidence. Approval and contract activation are disabled pending enforcement and renewal policy. No evidence upload is enabled.",
  notifications: "30-day and 15-day reminder identities have a durable outbox foundation. Scheduling and delivery are disabled until channel, recipients and send policy are approved.",
  diagnostics: "Only newly collected, redacted administrator-interface failures appear here. Historical Edge logs and tenant errors are not ingested. No automatic repair is enabled.",
  administrators: "Named identities are provisioned privately. No administrator creation, promotion, revocation or recovery endpoint is exposed here. Recovery review is an operator attestation, not a completed recovery drill.",
};

export function PlatformAdminPage({ section, preview }: Props) {
  if (preview && !import.meta.env.DEV) throw new Error("Platform administration preview is unavailable in production.");
  const [context, setContext] = useState<AdminContext | null>(null);
  const [authState, setAuthState] = useState<"loading" | "login" | "mfa" | "ready" | "recovery">(preview ? "ready" : "loading");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [code, setCode] = useState("");
  const [authError, setAuthError] = useState(""); const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false); const drawer = useRef<HTMLDivElement>(null); const closeButton = useRef<HTMLButtonElement>(null);
  const [data, setData] = useState<AdminResult | null>(null); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false); const [search, setSearch] = useState(""); const [submittedSearch, setSubmittedSearch] = useState("");
  const [status, setStatus] = useState(() => { const value = new URLSearchParams(window.location.search).get("status") ?? ""; return ["pending", "approved", "rejected", "live", "demo", "unclassified"].includes(value) ? value : ""; }); const [cursor, setCursor] = useState<AdminCursor | null>(null); const [refresh, setRefresh] = useState(0);
  const [fromDate, setFromDate] = useState(""); const [throughDate, setThroughDate] = useState("");
  const [invitationView, setInvitationView] = useState(false); const sequence = useRef(0);
  const [action, setAction] = useState<Action | null>(null); const dialog = useRef<HTMLDivElement>(null);
  const [reason, setReason] = useState(""); const [classification, setClassification] = useState("demo"); const [confirmed, setConfirmed] = useState(false);
  const [payment, setPayment] = useState({ restaurantId: "", amount: "", currency: "ETB", channel: "", paidAt: "", reference: "" });
  const [previewState, setPreviewState] = useState<"populated" | "loading" | "empty" | "error" | "partial" | "large">("populated");
  const [collapsed, setCollapsed] = useState(false);
  const [details, setDetails] = useState<AdminRow | null>(null);
  const detailDialog = useRef<HTMLDivElement>(null);
  useModalFocus(Boolean(details), () => setDetails(null), detailDialog);
  useEffect(() => { if (!menu && !action && !details) return; const previous = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = previous; }; }, [menu, action, details]);
  useModalFocus(menu, () => setMenu(false), drawer, closeButton);
  useModalFocus(Boolean(action), () => { if (!busy) setAction(null); }, dialog);

  async function establishContext() {
    const result = await adminContext(); setContext(result);
    setAuthState(!result.recoveryVerified ? "recovery" : result.mfaRequired ? "mfa" : "ready");
    if (result.recoveryVerified && !result.mfaRequired && section === "login") window.location.replace("/platform-admin/overview");
  }
  useEffect(() => {
    if (preview) { setAuthState("ready"); return; }
    let active = true;
    const client = getPlatformAdminClient();
    void client.auth.getSession().then(async ({ data: session }) => {
      if (!active) return;
      if (!session.session) { setAuthState("login"); return; }
      try { await establishContext(); } catch { if (active) { setAuthError("Administrator authorization could not be verified. No platform data was loaded."); setAuthState("login"); } }
    }).catch(() => { if (active) { setAuthState("login"); setAuthError("Administrator session unavailable."); } });
    const listener = client.auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") { sequence.current++; setData(null); setContext(null); setAction(null); setDetails(null); setAuthState("login"); }
    });
    return () => { active = false; sequence.current++; listener.data.subscription.unsubscribe(); };
  }, [preview]);

  const effectiveSection = section === "users" && invitationView ? "invitations" : section;
  useEffect(() => {
    if (authState !== "ready" || effectiveSection === "login") return;
    if (preview) preview.dataSource.setMode?.(previewState);
    if (previewState === "loading" && preview) { setData(null); setError(""); setLoading(true); return; }
    const request = ++sequence.current; setData(null); setError(""); setLoading(true);
    void (preview?.dataSource ?? privateAdminDataSource).read({ resource: effectiveSection, search: submittedSearch, status, cursor, from: fromDate, through: throughDate }).then(result => {
      if (sequence.current === request) setData(result);
    }).catch(cause => {
      if (sequence.current === request) {
        setError(preview && cause instanceof Error ? cause.message : safeAdminError(cause));
        if (!preview) void recordAdminDiagnostic("ADMIN_READ_FAILED").catch(() => false);
      }
    }).finally(() => { if (sequence.current === request) setLoading(false); });
    return () => { sequence.current++; };
  }, [authState, effectiveSection, submittedSearch, status, cursor, refresh, fromDate, throughDate, preview, previewState]);

  async function authenticate(event: FormEvent) {
    event.preventDefault(); setBusy(true); setAuthError("");
    try {
      const client = getPlatformAdminClient();
      if (authState === "mfa") {
        const factors = await client.auth.mfa.listFactors();
        const factor = factors.data?.totp.find(item => item.status === "verified");
        if (factors.error || !factor) { setAuthError("No verified TOTP factor is available. Follow the founder-controlled enrollment/recovery procedure."); return; }
        const result = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
        if (result.error) { setAuthError("MFA verification failed. Check your authenticator and try again."); return; }
        setCode("");
      } else {
        const result = await client.auth.signInWithPassword({ email: email.trim(), password });
        setPassword("");
        if (result.error) { setAuthError("Sign-in failed. Check your credentials or use the verified recovery procedure."); return; }
      }
      try { await establishContext(); } catch {
        await client.auth.signOut({ scope: "local" });
        setAuthError("This account is not an authorized platform administrator, or the platform service is not configured."); setAuthState("login");
      }
    } catch { setAuthError("Authentication service unavailable. Access was not granted."); }
    finally { setBusy(false); }
  }
  async function signOut() {
    setBusy(true);
    try { const { error: signOutError } = await getPlatformAdminClient().auth.signOut({ scope: "local" }); if (signOutError) throw signOutError; window.location.replace("/platform-admin/login"); }
    catch { setAuthError("Sign-out could not be confirmed. Close this administrator tab and follow the session-revocation procedure if necessary."); }
    finally { setBusy(false); }
  }
  function openAction(kind: Action["kind"], row?: AdminRow) {
    setAction({ kind, row, requestId: createBrowserUuid() }); setReason(""); setConfirmed(false); setNotice("");
    setClassification(typeof row?.classification === "string" ? row.classification : "demo");
  }
  async function commitAction(event: FormEvent) {
    event.preventDefault(); if (!action || !confirmed || reason.trim().length < (action.kind === "rejected" || action.kind === "payment-rejected" ? 10 : 3)) return;
    setBusy(true); setError("");
    try {
      const request: AdminMutationRequest = action.kind === "classification" ? { name: "platform_admin_classify", values: { target_restaurant_id: action.row!.id, classification, expected_version: action.row!.version, reason }, requestId: action.requestId }
        : action.kind === "approved" || action.kind === "rejected" ? { name: "platform_admin_decide_application", values: { application_id: action.row!.id, decision: action.kind, reason }, requestId: action.requestId }
        : action.kind === "payment-rejected" ? { name: "platform_admin_reject_payment", values: { payment_id: action.row!.id, reason }, requestId: action.requestId }
        : { name: "platform_admin_record_payment", values: { target_restaurant_id: payment.restaurantId.trim(), amount: Number(payment.amount), currency: payment.currency.trim().toUpperCase(), channel: payment.channel.trim(), paid_at: new Date(payment.paidAt).toISOString(), reference: payment.reference.trim(), reason }, requestId: action.requestId };
      await (preview?.dataSource ?? privateAdminDataSource).mutate(request);
      setNotice(preview ? "Demo decision saved for this preview session." : action.kind === "approved" ? "Application approved. Invitation delivery is not configured; no email or account was created." : "Change recorded with its server audit event.");
      setAction(null); setRefresh(value => value + 1);
    } catch (cause) {
      setError(safeAdminError(cause)); if (!preview) void recordAdminDiagnostic("ADMIN_ACTION_FAILED").catch(() => false);
    } finally { setBusy(false); }
  }

  if (authState !== "ready") return <main className="pa-root pa-entry">
    <section className="pa-login" aria-labelledby="pa-entry-title">
      <ShieldCheck aria-hidden="true" size={28} /><p className="pa-eyebrow">ServeFlow · Private administration</p>
      <h1 id="pa-entry-title">{authState === "loading" ? "Verifying access" : authState === "mfa" ? "Verify your authenticator" : authState === "recovery" ? "Recovery review required" : "Administrator sign in"}</h1>
      <p>Access is restricted to privately provisioned platform administrators. Restaurant accounts do not grant platform access.</p>
      {authError && <p role="alert" className="pa-error">{authError}</p>}
      {authState === "loading" ? <p role="status">Checking administrator session…</p> : authState === "recovery" ? <p>Privileged access is disabled until your verified recovery procedure is reviewed by the trusted operator. This page cannot provision or recover administrators.</p> : <form onSubmit={event => void authenticate(event)}>
        {authState === "mfa" ? <label>Authenticator code<input value={code} onChange={event => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></label> : <>
          <label>Administrator email<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" required /></label>
          <label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required /></label>
        </>}
        <button className="pa-primary" disabled={busy}>{busy ? "Verifying…" : authState === "mfa" ? "Verify MFA" : "Sign in"}</button>
      </form>}
      {context && <button type="button" disabled={busy} onClick={() => void signOut()}>Sign out</button>}
      <a href="/">Return to ServeFlow</a>
    </section>
  </main>;

  const activeSection = section === "login" ? "overview" : section;
  const title = pageTitles[activeSection];
  const pathFor = (key: AdminSection) => preview ? preview.pathFor(key) : `/platform-admin/${key}`;
  const detailColumns = columns[effectiveSection];
  const secondaryFields = ["slug", "contact_email", "contact_name", "decision_reason", "reference", "reason", "actor_id", "target_id", "request_id", "application_id", "id", "environment"];
  const list = detailColumns?.filter(([key]) => !secondaryFields.includes(key));
  const rows = data?.items ?? [];
  const actionAllowed = preview ? ["businesses", "applications", "payments"].includes(section) : section === "businesses" ? context?.canManage : section === "applications" ? context?.canManage : section === "payments" ? context?.canSensitive : false;
  return <div className={`pa-root pa-shell${collapsed ? " pa-collapsed" : ""}`}>
    <a className="pa-skip" href="#pa-content">Skip to content</a>
    <header className="pa-header"><a href={preview ? preview.pathFor("overview") : "/platform-admin/overview"} className="pa-brand"><ShieldCheck size={22} aria-hidden="true" />ServeFlow <span>Platform</span></a>
      <div><PublicThemeToggle />{preview ? <a className="pa-header-link" href="/platform-admin/login">Exit preview</a> : <><button type="button" onClick={() => { setCode(""); setAuthState("mfa"); setData(null); }}>Verify MFA</button><button type="button" aria-label="Sign out of platform administration" disabled={busy} onClick={() => void signOut()}><LogOut size={18} aria-hidden="true" /><span>Sign out</span></button></>}<button type="button" className="pa-menu" aria-label="Open platform navigation" onClick={() => setMenu(true)}><Menu aria-hidden="true" /></button></div>
    </header>
    {menu && <div className="pa-scrim" onClick={() => setMenu(false)} />}
    <div className={`pa-sidebar${menu ? " pa-open" : ""}`} ref={drawer} {...(menu ? { role: "dialog", "aria-modal": true, "aria-label": "Platform navigation" } : {})}>
      <button type="button" className="pa-menu pa-close" ref={closeButton} aria-label="Close platform navigation" onClick={() => setMenu(false)}><X aria-hidden="true" /></button>
      <div className="pa-workspace-context"><span className="pa-avatar"><ShieldCheck size={19} aria-hidden="true" /></span><div><strong>Platform workspace</strong><small>ServeFlow administration</small></div></div>
      <WorkspaceNavigation section={activeSection} pathFor={pathFor} onNavigate={() => setMenu(false)} />
      <div className="pa-sidebar-footer"><span className="pa-avatar">{preview ? "P" : context?.displayName?.slice(0, 1)}</span><div><strong>{preview ? "Visual preview" : context?.displayName}</strong><small>{preview ? "No administrative access" : "Private platform access"}</small></div></div>
      <button className="pa-collapse" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setCollapsed(value => !value)}>{collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}<span>Collapse sidebar</span></button>
    </div>
    <main id="pa-content" tabIndex={-1} className="pa-content">
      {preview && <div className="pa-preview-strip"><strong>LOCAL PREVIEW · SYNTHETIC DATA</strong><details className="pa-preview-tools"><summary><SlidersHorizontal size={14} aria-hidden="true" />Preview controls</summary><div><p>Local visual review only. No administrator access is granted. Changes stay in memory.</p><label>Display state<select value={previewState} onChange={event => setPreviewState(event.target.value as typeof previewState)}><option value="populated">Populated</option><option value="loading">Loading</option><option value="empty">Empty</option><option value="error">Error</option><option value="partial">Partial</option><option value="large">525 rows</option></select></label></div></details></div>}
      <div className="pa-title"><div><p className="pa-eyebrow">{["contracts", "payments"].includes(section) ? "Subscriptions & Payments" : ["overview", "applications", "businesses", "users", "notifications"].includes(section) ? "Workspace" : "System & Security"}</p><h1>{title}</h1><p className="pa-description">{descriptions[activeSection]}</p></div><button type="button" onClick={() => setRefresh(value => value + 1)} disabled={loading}><RefreshCw size={16} aria-hidden="true" /><span>Refresh</span></button></div>
      <WorkspaceTabs section={activeSection} pathFor={pathFor} />
      {authError && <p role="alert" className="pa-error">{authError}</p>}
      {notes[section as AdminSection] && <details className="pa-policy"><summary>Available actions & policy</summary><p>{notes[section as AdminSection]}</p></details>}
      {error && <div role="alert" className="pa-error">{error}<button type="button" onClick={() => { if (preview) setPreviewState("populated"); else setRefresh(value => value + 1); }}>Try again</button></div>}
      {notice && <p role="status" className="pa-success">{notice}</p>}
      {section === "users" && <div className="pa-tabs"><button aria-pressed={!invitationView} onClick={() => { setInvitationView(false); setCursor(null); }}>Business members</button><button aria-pressed={invitationView} onClick={() => { setInvitationView(true); setCursor(null); }}>Invitations</button></div>}
      {list && <form className="pa-filters" onSubmit={event => { event.preventDefault(); setCursor(null); setSubmittedSearch(search.trim()); }}>
        <label>Search<input value={search} onChange={event => setSearch(event.target.value)} maxLength={100} placeholder={section === "audit-logs" ? "Action, actor, target or request ID" : "Search records"} /></label>
        {["businesses", "applications", "payments", "audit-logs"].includes(section) && <label>Status<select aria-label="Status" value={status} onChange={event => { setStatus(event.target.value); setCursor(null); }}><option value="">All</option>{(section === "businesses" ? ["demo", "live", "unclassified"] : section === "audit-logs" ? ["succeeded", "rejected"] : ["pending", ...(section === "applications" ? ["approved"] : []), "rejected"]).map(value => <option key={value} value={value}>{value}</option>)}</select></label>}
        <button type="submit"><Search size={16} aria-hidden="true" />Search</button>
        {section === "audit-logs" && <><label>From date (UTC)<input type="date" value={fromDate} onChange={event => { setFromDate(event.target.value); setCursor(null); }} /></label><label>Through date (UTC)<input type="date" value={throughDate} onChange={event => { setThroughDate(event.target.value); setCursor(null); }} /></label></>}
      </form>}
      {section === "contracts" && <p className="pa-small">Term timing is calculated from recorded dates. It does not confirm payment, renewal, or operational access.</p>}
      {section === "payments" && <button type="button" disabled={!preview && !context?.canManage} onClick={() => openAction("record-payment")}>Record submitted payment</button>}
      {loading && <div role="status" className="pa-loading"><p>Loading authorized platform information…</p><div className="pa-skeleton" /><div className="pa-skeleton" /><div className="pa-skeleton" /></div>}
      {!loading && data && section === "overview" && <PlatformOverview data={data} pathFor={pathFor} synthetic={Boolean(preview)} />}
      {!loading && data && list && <>
        {rows.length === 0 ? <p className="pa-empty">No records match this query. Unsupported collection and delivery workflows remain disabled.</p> : <div className="pa-table-wrap" tabIndex={0} role="region" aria-label={`${title} records`}><table><thead><tr>{list.map(([key, label]) => <th key={key} scope="col">{label}</th>)}<th scope="col">Details</th>{actionAllowed && <th scope="col">Action</th>}</tr></thead><tbody>{rows.map(row => <tr key={row.id}>{list.map(([key, label]) => <td key={key} data-label={label}>{key === "term_timing" ? <StatusBadge value={contractTiming(row.starts_at, row.ends_at, data.asOf)} /> : key === "owners" ? Array.isArray(row.owners) && row.owners.length ? row.owners.map(owner => display((owner as Record<string, unknown>).name)).join(", ") : "Unresolved" : key.endsWith("_at") ? date(row[key]) : ["status", "classification", "active", "outcome", "delivery_status", "recovery_verified", "can_manage", "can_sensitive"].includes(key) ? <StatusBadge value={row[key]} /> : display(row[key])}</td>)}<td data-label="Details"><button onClick={() => setDetails(row)} aria-label={`View details for ${display(row.name ?? row.business_name ?? row.display_name ?? row.action ?? row.code ?? row.id)}`}>View details</button></td>{actionAllowed && <td data-label="Action"><div className="pa-row-actions">{section === "businesses" ? <button onClick={() => openAction("classification", row)}>Review classification</button> : row.status === "pending" && section === "applications" ? <><button onClick={() => openAction("approved", row)}>Approve</button><button onClick={() => openAction("rejected", row)}>Reject</button></> : row.status === "pending" && section === "payments" ? <button onClick={() => openAction("payment-rejected", row)}>Reject payment</button> : <span className="pa-small">Reviewed</span>}</div></td>}</tr>)}</tbody></table></div>}
        <div className="pa-pagination"><button disabled={!cursor} onClick={() => setCursor(null)}><ArrowLeft size={16} aria-hidden="true" />First page</button><button disabled={!data.nextCursor} onClick={() => setCursor(data.nextCursor ?? null)}>Next page</button></div>
      </>}
      {!loading && data && section === "system-health" && <section className="pa-panel"><h2>Observed service checks</h2><dl>{["database", "frontend", "auth", "storage", "realtime", "edgeFunctions"].map(key => <div key={key}><dt>{{ database: "Database", frontend: "Web application", auth: "Sign-in service", storage: "File storage", realtime: "Live updates", edgeFunctions: "Background services" }[key]}</dt><dd><StatusBadge value={key === "database" ? (data.database as Record<string, unknown>)?.status : data[key]} /></dd></div>)}</dl><p>{display((data.database as Record<string, unknown>)?.meaning)}</p><p>Unknown means no supported live probe was performed. This view does not check or resume printing.</p></section>}
      {!loading && data && section === "integrations" && <section className="pa-panel"><h2>Integration evidence</h2><dl>{["Supabase Auth", "Storage", "Realtime", "OpenAI menu imports"].map(name => <div key={name}><dt>{name}</dt><dd>Not verified — no integration health probe configured</dd></div>)}<div><dt>Invitation and reminder delivery</dt><dd>Not configured</dd></div><div><dt>Printer integration</dt><dd>Paused — excluded from checks and recovery</dd></div></dl></section>}
      {!loading && data && section === "backups" && <section className="pa-panel"><h2>Recovery readiness</h2><dl>{["Backup configured", "Last successful backup", "Restoration tested", "Verified restorable"].map(label => <div key={label}><dt>{label}</dt><dd>Unknown — no verified backup evidence available</dd></div>)}</dl><p>Restoration requires a separately approved runbook, verified target, pre-restoration safeguard, out-of-band authorization and post-restore validation. No restore or shell action is exposed.</p></section>}
      {!loading && data && section === "security" && <section className="pa-panel"><h2>Enforced administrator boundary</h2><p>{display(data.mfa)}</p><p>Administrator authorization is checked in the database for every platform operation. Verified recovery must be recorded through the trusted provisioning procedure. User metadata and tenant roles do not grant access.</p><h2>Unavailable capabilities</h2><p>New application intake, invitation delivery/acceptance, provisioning, trial activation, contract activation/renewal, suspension/restoration, notification sending and recovery mutations are disabled. No dashboard switch enables them.</p></section>}
      {data && <p className="pa-small pa-source">Source: {data.source} · Checked {date(data.asOf)}</p>}
    </main>
    {details && <div className="pa-dialog-backdrop"><section className="pa-dialog pa-detail-panel" ref={detailDialog} role="dialog" aria-modal="true" aria-labelledby="pa-detail-title"><button type="button" className="pa-detail-close" aria-label="Close record details" onClick={() => setDetails(null)}><X size={18} /></button><p className="pa-eyebrow">{title} · Record details</p><h2 id="pa-detail-title">{display(details.name ?? details.business_name ?? details.display_name ?? "Record details")}</h2>{preview && <p className="pa-small">Synthetic record for visual review only.</p>}<dl>{(detailColumns ?? []).filter(([key]) => !["id", "actor_id", "target_id", "request_id", "application_id", "contract_id"].includes(key)).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{key === "term_timing" ? contractTiming(details.starts_at, details.ends_at, data?.asOf ?? "") : key === "owners" ? Array.isArray(details.owners) ? details.owners.map(owner => display((owner as Record<string, unknown>).name)).join(", ") || "Unresolved" : "Unresolved" : key.endsWith("_at") ? date(details[key]) : display(details[key])}</dd></div>)}</dl><details className="pa-policy"><summary>Technical references</summary><dl>{["id", "actor_id", "target_id", "request_id", "application_id", "contract_id"].filter(key => details[key] != null).map(key => <div key={key}><dt>{key.replace(/_/g, " ")}</dt><dd>{display(details[key])}</dd></div>)}</dl></details></section></div>}
    {action && <div className="pa-dialog-backdrop"><div className="pa-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="pa-action-title">
      <h2 id="pa-action-title">Confirm {action.kind.replace(/-/g, " ")}</h2><p>{display(action.row?.name ?? action.row?.business_name ?? "Subscription payment review")}</p>
      <form onSubmit={event => void commitAction(event)}>{preview && <p className="pa-preview-dialog-note">Demo data. Changes stay in this preview session.</p>}
        {action.kind === "classification" && <label>Reviewed classification<select value={classification} onChange={event => setClassification(event.target.value)}>{["demo", "live", "unclassified"].map(value => <option key={value}>{value}</option>)}</select></label>}
        {action.kind === "record-payment" && <>{([["restaurantId", "Business UUID", "text"], ["amount", "Amount", "number"], ["currency", "Currency code", "text"], ["channel", "Payment channel", "text"], ["paidAt", "Payment date and time", "datetime-local"], ["reference", "Transaction reference", "text"]] as const).map(([key, label, type]) => <label key={key}>{label}<input type={type} value={payment[key]} onChange={event => setPayment(previous => ({ ...previous, [key]: event.target.value }))} {...(key === "amount" ? { min: "0.01", step: "0.01" } : {})} required maxLength={key === "currency" ? 3 : 120} /></label>)}</>}
        <label>Decision reason<textarea value={reason} onChange={event => setReason(event.target.value)} minLength={action.kind === "rejected" || action.kind === "payment-rejected" ? 10 : 3} maxLength={500} required /></label><p className="pa-small">Do not enter passwords, tokens, payment credentials or unnecessary personal information.</p>
        <label className="pa-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required />{preview ? "I reviewed this demo record." : "I reviewed the target and understand this decision will be audited."}</label>
        {action.kind === "approved" && <p>Approval does not send an invitation, provision an account or activate a trial.</p>}
        {error && <p role="alert" className="pa-error">{error}</p>}
        <div className="pa-row-actions"><button type="button" disabled={busy} onClick={() => setAction(null)}>Cancel</button><button className="pa-primary" disabled={busy || !confirmed || reason.trim().length < (action.kind === "rejected" || action.kind === "payment-rejected" ? 10 : 3)}>{busy ? "Recording…" : "Confirm decision"}</button></div>
      </form>
    </div></div>}
  </div>;
}
