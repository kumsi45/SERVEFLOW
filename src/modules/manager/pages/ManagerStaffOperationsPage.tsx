import { useCallback, useEffect, useMemo, useState } from "react";
import { useTenantRealtime } from "../../../core/realtime/useTenantRealtime";
import {
  activateManagerStaff,
  createManagerStaff,
  deactivateManagerStaff,
  endManagerStaffBreak,
  loadManagerStaffOperations,
  markManagerStaffBreak,
  resetManagerStaffPassword,
  sendManagerStaffMessage,
  suspendManagerStaff,
  type ManagerStaffMember,
  type ManagerStaffOperationsSnapshot,
  type ManagerStaffRole,
} from "../services/managerStaffOperationsService";
import { managerStaffEmailRequired, validateManagerStaffCreation } from "../services/managerStaffCreationValidation";
import "../styles/managerStaffOperations.css";

type Props = {
  restaurantId: string;
  restaurantName: string;
  managerName: string;
};

type StaffTab = "overview" | "directory" | "shift" | "create";
type StaffFilters = { search: string; role: string; status: string; shift: string };

const STAFF_TABS: Array<[StaffTab, string]> = [
  ["overview", "Overview"],
  ["directory", "Directory"],
  ["shift", "Shift Status"],
];

const CREATE_ROLES: Array<{ role: ManagerStaffRole; label: string; available: boolean }> = [
  { role: "waiter", label: "Waiter", available: true },
  { role: "cashier", label: "Cashier", available: true },
  { role: "kitchen", label: "Chef", available: true },
  { role: "inventory_officer", label: "Inventory Officer", available: true },
];

function roleLabel(role: ManagerStaffRole) {
  if (role === "kitchen") return "Chef";
  if (role === "inventory_officer") return "Inventory Officer";
  if (role === "inventory") return "Inventory Staff";
  return role.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function operationalStatus(member: ManagerStaffMember) {
  if (!member.active) return { label: "Inactive", tone: "muted" as const };
  if (member.online && member.breakStatus === "on_break") return { label: "On break", tone: "warning" as const };
  if (member.currentWorkload > 0) return { label: "Busy", tone: "busy" as const };
  if (member.online) return { label: "Available", tone: "healthy" as const };
  return { label: "Offline", tone: "muted" as const };
}

function currentWork(member: ManagerStaffMember, compact = false) {
  if (member.role === "waiter") {
    if (!member.assignedTables.length) return compact ? "No active tables" : "No active table assignments";
    if (compact) return `${member.assignedTables.length} table${member.assignedTables.length === 1 ? "" : "s"}`;
    return member.assignedTables.map((table) => table.label).join(", ");
  }
  if (member.role === "kitchen") return member.assignedKitchenStationName ?? "Unassigned";
  if (member.role === "cashier") return member.online ? "Cashier terminal" : "No active work";
  if (member.role === "inventory" || member.role === "inventory_officer") return member.online ? "Inventory workspace" : "No active work";
  return "No active work";
}

function StatusPill({ member }: { member: ManagerStaffMember }) {
  const status = operationalStatus(member);
  return <span className={`mso-status-pill ${status.tone}`}><span aria-hidden="true" />{status.label}</span>;
}

function StaffIdentity({ member }: { member: ManagerStaffMember }) {
  return (
    <div className="mso-staff-identity">
      <span className="mso-avatar" aria-hidden="true">{member.avatarInitials}</span>
      <span><strong>{member.fullName}</strong><small>{member.employeeId}</small></span>
    </div>
  );
}

function ShiftValue() {
  return <span className="mso-not-recorded" title="ServeFlow does not currently store explicit staff check-in records.">Not recorded</span>;
}

export function ManagerStaffOperationsPage({ restaurantId, restaurantName }: Props) {
  const [snapshot, setSnapshot] = useState<ManagerStaffOperationsSnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<StaffTab>("overview");
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [filters, setFilters] = useState<StaffFilters>({ search: "", role: "all", status: "all", shift: "all" });
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionPending, setActionPending] = useState(false);
  const [form, setForm] = useState({ fullName: "", email: "", phoneNumber: "", pinPassword: "", role: "waiter" as ManagerStaffRole });

  const refresh = useCallback(async () => {
    try {
      const next = await loadManagerStaffOperations(restaurantId);
      setSnapshot(next);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load staff.");
    } finally {
      setLoading(false);
    }
  }, [restaurantId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useTenantRealtime({
    channelName: "manager-staff-operations",
    restaurantId,
    tables: ["restaurant_staff", "restaurant_table_waiter_assignments", "kitchen_stations", "orders", "order_items", "staff_activity_log"],
    refresh,
  });

  useEffect(() => {
    if (!selectedStaffId) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setSelectedStaffId(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [selectedStaffId]);

  const staff = snapshot?.staff ?? [];
  const selectedStaff = staff.find((member) => member.id === selectedStaffId) ?? null;
  const filteredStaff = useMemo(() => staff.filter((member) => {
    const term = filters.search.trim().toLowerCase();
    const matchesSearch = !term || [member.fullName, member.employeeId, member.email ?? "", member.phoneNumber ?? ""].some((value) => value.toLowerCase().includes(term));
    const status = operationalStatus(member).label.toLowerCase().replace(" ", "_");
    return matchesSearch
      && (filters.role === "all" || member.role === filters.role)
      && (filters.status === "all" || status === filters.status)
      && (filters.shift === "all" || member.shiftStatus === filters.shift);
  }), [filters, staff]);

  const liveStaff = useMemo(() => [...staff].sort((a, b) => Number(b.online) - Number(a.online) || b.currentWorkload - a.currentWorkload || a.fullName.localeCompare(b.fullName)), [staff]);
  const counts = useMemo(() => ({
    available: staff.filter((member) => operationalStatus(member).label === "Available").length,
    busy: staff.filter((member) => operationalStatus(member).label === "Busy").length,
    break: staff.filter((member) => member.online && member.breakStatus === "on_break").length,
  }), [staff]);

  async function runAction(action: () => Promise<unknown>, success: string) {
    setActionPending(true);
    setNotice(null);
    setError(null);
    try {
      const response = await action();
      const temporaryPassword = response && typeof response === "object" ? (response as { temporaryPassword?: string }).temporaryPassword : null;
      setNotice(temporaryPassword ? `${success} Temporary password: ${temporaryPassword}` : success);
      await refresh();
      return true;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Staff action failed.");
      return false;
    } finally {
      setActionPending(false);
    }
  }

  async function submitCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!CREATE_ROLES.some((option) => option.role === form.role && option.available)) return;
    const validationError = validateManagerStaffCreation({
      fullName: form.fullName,
      email: form.email,
      pin: form.pinPassword,
      role: form.role,
    });
    if (validationError) {
      setNotice(null);
      setError(validationError);
      return;
    }
    const created = await runAction(() => createManagerStaff(restaurantId, {
      fullName: form.fullName,
      email: form.email || undefined,
      phoneNumber: form.phoneNumber || undefined,
      pinPassword: form.pinPassword,
      role: form.role,
    }), "Staff account created.");
    if (!created) return;
    setForm({ fullName: "", email: "", phoneNumber: "", pinPassword: "", role: "waiter" });
    setActiveTab("directory");
  }

  function openRelated(member: ManagerStaffMember) {
    const path = member.role === "waiter" ? "/manager/tables" : "/manager/kitchen";
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  return (
    <main className="mso-page">
      <header className="mso-page-header">
        <div><p>{restaurantName}</p><h1>Staff</h1><span>Live workforce status</span></div>
        <button type="button" className="mso-primary-action" onClick={() => setActiveTab("create")}>+ Add Staff</button>
      </header>

      <nav className="mso-tabs" aria-label="Staff workspace">
        {STAFF_TABS.map(([key, label]) => <button key={key} type="button" className={activeTab === key ? "active" : ""} aria-current={activeTab === key ? "page" : undefined} onClick={() => setActiveTab(key)}>{label}</button>)}
      </nav>

      {notice && <div className="mso-notice success" role="status">{notice}<button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)}>×</button></div>}
      {error && <div className="mso-notice error" role="alert">{error}<button type="button" aria-label="Dismiss error" onClick={() => setError(null)}>×</button></div>}

      {loading ? <section className="mso-state">Loading staff workspace…</section> : (
        <>
          {(activeTab === "overview" || activeTab === "shift") && (
            <section className="mso-metrics" aria-label="Current workforce summary">
              <div><span>On Shift</span><strong>—</strong><small>Not recorded</small></div>
              <div><span>Available</span><strong>{counts.available}</strong><small>Online, no active work</small></div>
              <div><span>Busy</span><strong>{counts.busy}</strong><small>Active workload</small></div>
              <div><span>On Break</span><strong>{counts.break}</strong><small>Recorded break state</small></div>
              <div><span>Off Shift</span><strong>—</strong><small>Not recorded</small></div>
            </section>
          )}

          {activeTab === "overview" && (
            <section className="mso-panel">
              <div className="mso-section-heading"><div><p>Current workforce</p><h2>Live Staff</h2></div><span>{staff.length} staff</span></div>
              <div className="mso-data-list mso-live-list">
                <div className="mso-list-header" aria-hidden="true"><span>Staff</span><span>Role</span><span>Shift</span><span>Status</span><span>Current Work</span><span /></div>
                {liveStaff.length ? liveStaff.map((member) => (
                  <button className="mso-staff-row" type="button" key={member.id} onClick={() => setSelectedStaffId(member.id)}>
                    <StaffIdentity member={member} /><span data-label="Role">{roleLabel(member.role)}</span><span data-label="Shift"><ShiftValue /></span><span data-label="Status"><StatusPill member={member} /></span><span data-label="Current work" className="mso-current-work">{currentWork(member)}</span><span className="mso-chevron" aria-hidden="true">›</span>
                  </button>
                )) : <div className="mso-empty"><strong>No staff records found.</strong><span>Create a staff account to begin.</span></div>}
              </div>
            </section>
          )}

          {activeTab === "directory" && (
            <section className="mso-panel">
              <div className="mso-section-heading"><div><p>People and access</p><h2>Directory</h2></div><span>{filteredStaff.length} results</span></div>
              <div className="mso-directory-toolbar">
                <label className="mso-search"><span aria-hidden="true">⌕</span><input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Search staff…" aria-label="Search staff" /></label>
                <select aria-label="Filter by role" value={filters.role} onChange={(event) => setFilters((current) => ({ ...current, role: event.target.value }))}><option value="all">All roles</option><option value="waiter">Waiter</option><option value="cashier">Cashier</option><option value="kitchen">Chef</option><option value="inventory_officer">Inventory Officer</option><option value="inventory">Inventory Staff</option></select>
                <select aria-label="Filter by status" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="all">All statuses</option><option value="available">Available</option><option value="busy">Busy</option><option value="on_break">On break</option><option value="offline">Offline</option><option value="inactive">Inactive</option></select>
                <select aria-label="Filter by shift" value={filters.shift} onChange={(event) => setFilters((current) => ({ ...current, shift: event.target.value }))}><option value="all">All shifts</option><option value="not_recorded">Not recorded</option></select>
              </div>
              <div className="mso-data-list mso-directory-list">
                <div className="mso-list-header" aria-hidden="true"><span>Staff</span><span>Role</span><span>Shift</span><span>Status</span><span>Current Work</span><span /></div>
                {filteredStaff.length ? filteredStaff.map((member) => (
                  <button type="button" className="mso-directory-row" key={member.id} onClick={() => setSelectedStaffId(member.id)} aria-label={`View ${member.fullName} staff profile`}>
                    <StaffIdentity member={member} /><span data-label="Role">{roleLabel(member.role)}</span><span data-label="Shift"><ShiftValue /></span><span data-label="Status"><StatusPill member={member} /></span><span data-label="Current work" className="mso-current-work">{currentWork(member, true)}</span><span className="mso-chevron" aria-hidden="true">›</span>
                  </button>
                )) : <div className="mso-empty"><strong>No staff match these filters.</strong><button type="button" onClick={() => setFilters({ search: "", role: "all", status: "all", shift: "all" })}>Clear filters</button></div>}
              </div>
            </section>
          )}

          {activeTab === "shift" && (
            <section className="mso-panel">
              <div className="mso-section-heading"><div><p>Current status</p><h2>Shift Status</h2></div></div>
              <div className="mso-capability-note"><strong>Shift check-in is not recorded.</strong><span>Online status reflects an operational account session, not employee attendance or arrival time.</span></div>
              <div className="mso-data-list mso-shift-list">
                <div className="mso-list-header" aria-hidden="true"><span>Name</span><span>Role</span><span>Shift Start</span><span>Status</span><span>Current Work</span><span /></div>
                {liveStaff.length ? liveStaff.map((member) => <button type="button" className="mso-staff-row" key={member.id} onClick={() => setSelectedStaffId(member.id)}><StaffIdentity member={member} /><span data-label="Role">{roleLabel(member.role)}</span><span data-label="Shift start"><ShiftValue /></span><span data-label="Status"><StatusPill member={member} /></span><span data-label="Current work" className="mso-current-work">{currentWork(member, true)}</span><span className="mso-chevron" aria-hidden="true">›</span></button>) : <div className="mso-empty"><strong>No staff records found.</strong></div>}
              </div>
            </section>
          )}

          {activeTab === "create" && (
            <section className="mso-panel mso-create-panel">
              <div className="mso-section-heading"><div><p>Secure account setup</p><h2>Create Staff</h2></div><span>Employee ID generated automatically</span></div>
              <form className="mso-create-form" onSubmit={submitCreate} noValidate>
                <fieldset><legend>Role</legend><div className="mso-role-options">
                  <button type="button" className={form.role === "waiter" ? "selected" : ""} onClick={() => setForm((current) => ({ ...current, role: "waiter" }))}>Waiter</button>
                  <button type="button" className={form.role === "cashier" ? "selected" : ""} onClick={() => setForm((current) => ({ ...current, role: "cashier" }))}>Cashier</button>
                  <button type="button" className={form.role === "kitchen" ? "selected" : ""} onClick={() => setForm((current) => ({ ...current, role: "kitchen" }))}>Chef</button>
                  <button type="button" className={form.role === "inventory_officer" ? "selected" : ""} onClick={() => setForm((current) => ({ ...current, role: "inventory_officer" }))}>Inventory Officer</button>
                </div></fieldset>
                <div className="mso-form-grid">
                  <label><span>Full Name *</span><input required value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} autoComplete="name" /></label>
                  <label><span>Phone</span><input value={form.phoneNumber} onChange={(event) => setForm((current) => ({ ...current, phoneNumber: event.target.value }))} autoComplete="tel" /></label>
                  <label><span>{managerStaffEmailRequired(form.role) ? "Email *" : "Email (optional)"}</span><input type="email" required={managerStaffEmailRequired(form.role)} value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} autoComplete="email" /></label>
                  <label><span>4-digit PIN *</span><input required type="password" inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} value={form.pinPassword} onChange={(event) => setForm((current) => ({ ...current, pinPassword: event.target.value.replace(/\D/g, "").slice(0, 4) }))} autoComplete="new-password" /></label>
                </div>
                <div className="mso-form-actions"><button type="button" onClick={() => setActiveTab("overview")}>Cancel</button><button type="submit" className="mso-primary-action" disabled={actionPending}>{actionPending ? "Creating…" : `Create ${roleLabel(form.role)}`}</button></div>
              </form>
            </section>
          )}
        </>
      )}

      {selectedStaff && <>
        <button className="mso-drawer-backdrop" type="button" aria-label="Close staff details" onClick={() => setSelectedStaffId(null)} />
        <aside className="mso-inspector" role="dialog" aria-modal="true" aria-labelledby="mso-inspector-title">
          <header><div><p>Staff Profile</p><h2 id="mso-inspector-title">{selectedStaff.fullName}</h2><span>{roleLabel(selectedStaff.role)} · ID: {selectedStaff.employeeId}</span></div><button type="button" aria-label="Close staff details" onClick={() => setSelectedStaffId(null)}>×</button></header>
          <div className="mso-inspector-body">
            <div className="mso-inspector-summary"><span className={`mso-role-badge ${selectedStaff.role}`}>{roleLabel(selectedStaff.role)}</span><StatusPill member={selectedStaff} /></div>
            <section><h3>Account</h3><dl><div><dt>Account status</dt><dd>{selectedStaff.active ? "Active" : "Inactive"}</dd></div><div><dt>Access</dt><dd>{selectedStaff.active ? "Enabled" : "Disabled"}</dd></div></dl></section>
            <section><h3>Current Status</h3><dl><div><dt>Shift</dt><dd><ShiftValue /></dd></div><div><dt>Status</dt><dd>{operationalStatus(selectedStaff).label}</dd></div></dl></section>
            <section><h3>Shift</h3><dl><div><dt>Started</dt><dd><ShiftValue /></dd></div><div><dt>Duration</dt><dd>Not recorded</dd></div><div><dt>Break</dt><dd>{selectedStaff.online && selectedStaff.breakStatus === "on_break" ? "On break" : selectedStaff.breakStatus === "not_on_break" ? "Not on break" : "Not recorded"}</dd></div></dl></section>
            <section><h3>Current Work</h3><p className="mso-inspector-work">{currentWork(selectedStaff)}</p>{selectedStaff.role === "waiter" && <dl className="mso-inspector-work-meta"><div><dt>Active orders</dt><dd>{selectedStaff.activeOrders}</dd></div></dl>}</section>
            <section><h3>Role &amp; Access</h3><dl><div><dt>Current role</dt><dd>{roleLabel(selectedStaff.role)}</dd></div></dl></section>
            <section><h3>Contact</h3><dl><div><dt>Phone</dt><dd>{selectedStaff.phoneNumber || "Not provided"}</dd></div><div><dt>Email</dt><dd>{selectedStaff.email || "Not provided"}</dd></div></dl></section>
            <section className="mso-inspector-actions"><h3>Actions</h3>
              <form onSubmit={async (event) => { event.preventDefault(); if (!message.trim()) return; if (await runAction(() => sendManagerStaffMessage(restaurantId, selectedStaff.id, message.trim(), false), "Message recorded.")) setMessage(""); }}><label><span>Message</span><textarea rows={2} value={message} onChange={(event) => setMessage(event.target.value)} placeholder={`Message ${selectedStaff.fullName}`} /></label><button type="submit" disabled={actionPending || !message.trim()}>Send Message</button></form>
              <div className="mso-action-grid">
                {selectedStaff.online && selectedStaff.breakStatus === "on_break" ? <button type="button" disabled={actionPending} onClick={() => void runAction(() => endManagerStaffBreak(restaurantId, selectedStaff.id), "Break ended.")}>End Break</button> : <button type="button" disabled={actionPending || !selectedStaff.online} onClick={() => void runAction(() => markManagerStaffBreak(restaurantId, selectedStaff.id), "Break started.")}>Start Break</button>}
                {(selectedStaff.role === "waiter" || selectedStaff.role === "kitchen") && <button type="button" onClick={() => openRelated(selectedStaff)}>Open {selectedStaff.role === "waiter" ? "Live Operations" : "Kitchen"} →</button>}
              </div>
              <details><summary>More Actions</summary><div>
                {!selectedStaff.active ? <button type="button" disabled={actionPending} onClick={() => void runAction(() => activateManagerStaff(restaurantId, selectedStaff.id), "Staff account activated.")}>Activate</button> : <button type="button" disabled={actionPending} onClick={() => { if (window.confirm(`Deactivate ${selectedStaff.fullName}?`)) void runAction(() => deactivateManagerStaff(restaurantId, selectedStaff.id), "Staff account deactivated."); }}>Deactivate</button>}
                {selectedStaff.active && <button type="button" disabled={actionPending} onClick={() => { if (window.confirm(`Suspend ${selectedStaff.fullName}?`)) void runAction(() => suspendManagerStaff(restaurantId, selectedStaff.id), "Staff account suspended."); }}>Suspend</button>}
                <button type="button" disabled={actionPending} onClick={() => { if (window.confirm(`Generate a temporary password for ${selectedStaff.fullName}?`)) void runAction(() => resetManagerStaffPassword(restaurantId, selectedStaff.id), "Password reset."); }}>Reset Password</button>
              </div></details>
            </section>
          </div>
        </aside>
      </>}
    </main>
  );
}
