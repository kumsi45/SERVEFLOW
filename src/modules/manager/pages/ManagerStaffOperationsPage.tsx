import { useCallback, useEffect, useMemo, useState } from "react";
import { useTenantRealtime } from "../../../core/realtime/useTenantRealtime";
import {
  activateManagerStaff,
  assignWaiterTables,
  createManagerStaff,
  deactivateManagerStaff,
  endManagerStaffBreak,
  loadManagerStaffOperations,
  markManagerStaffBreak,
  resetManagerStaffPassword,
  sendManagerStaffMessage,
  suspendManagerStaff,
  updateManagerStaff,
  type ManagerDirectoryRole,
  type ManagerStaffMember,
  type ManagerStaffOperationsSnapshot,
  type ManagerStaffRole,
} from "../services/managerStaffOperationsService";
import "../styles/managerStaffOperations.css";

type Props = {
  restaurantId: string;
  restaurantName: string;
  managerName: string;
};

type StaffTab = "directory" | "assignments" | "activity" | "create" | "analytics";

const STAFF_TABS: Array<[StaffTab, string]> = [
  ["directory", "Directory"],
  ["assignments", "Assignment Center"],
  ["activity", "Activity"],
  ["create", "Create Staff"],
  ["analytics", "Analytics"],
];

const ROLE_OPTIONS: Array<{ value: ManagerDirectoryRole; label: string; enabled: boolean }> = [
  { value: "waiter", label: "Waiters", enabled: true },
  { value: "cashier", label: "Cashiers", enabled: true },
  { value: "kitchen", label: "Kitchen Staff", enabled: true },
  { value: "inventory_officer", label: "Inventory Officers", enabled: true },
  { value: "inventory", label: "Inventory Staff (Legacy)", enabled: true },
  { value: "supervisor", label: "Supervisors", enabled: false },
  { value: "reception", label: "Reception", enabled: false },
];

function fmtDate(value: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function roleLabel(role: string) {
  if (role === "kitchen") return "Kitchen Staff";
  return role.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function activityLabel(action: string) {
  return action.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function ManagerStaffOperationsPage({ restaurantId, restaurantName, managerName }: Props) {
  const [snapshot, setSnapshot] = useState<ManagerStaffOperationsSnapshot | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filters, setFilters] = useState({ name: "", employeeId: "", role: "all", status: "all", shift: "all", station: "all" });
  const [wizardStep, setWizardStep] = useState(1);
  const [form, setForm] = useState({ fullName: "", email: "", pinPassword: "", phoneNumber: "", role: "waiter" as ManagerStaffRole, assignedKitchenStationId: "", shift: "", section: "" });
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<StaffTab>("assignments");
  const [createOpen, setCreateOpen] = useState(false);
  const [assignmentDraft, setAssignmentDraft] = useState({ waiterId: "", tableIds: [] as string[], kitchenStaffId: "", stationId: "", cashierId: "", cashierShift: "" });
  const [dragStaffId, setDragStaffId] = useState<string | null>(null);
  const [dragTableId, setDragTableId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await loadManagerStaffOperations(restaurantId);
      setSnapshot(next);
      setLoading(false);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load staff operations.");
      setLoading(false);
    }
  }, [restaurantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useTenantRealtime({ channelName: "manager-staff-operations", restaurantId, tables: ["restaurant_staff", "restaurant_table_waiter_assignments", "kitchen_stations", "orders", "order_items", "staff_activity_log"], refresh });

  const staff = snapshot?.staff ?? [];
  const selectedStaff = staff.find((member) => member.id === selectedStaffId) ?? staff[0] ?? null;

  useEffect(() => {
    if (!selectedStaffId && staff[0]) setSelectedStaffId(staff[0].id);
  }, [selectedStaffId, staff]);

  const filteredStaff = useMemo(() => staff.filter((member) => {
    const matchesName = member.fullName.toLowerCase().includes(filters.name.toLowerCase());
    const matchesEmployeeId = member.employeeId.toLowerCase().includes(filters.employeeId.toLowerCase());
    const matchesRole = filters.role === "all" || member.role === filters.role;
    const matchesStatus = filters.status === "all" || (filters.status === "active" ? member.active : !member.active);
    const matchesShift = filters.shift === "all" || member.shiftStatus === filters.shift;
    const matchesStation = filters.station === "all" || member.assignedKitchenStationId === filters.station;
    return matchesName && matchesEmployeeId && matchesRole && matchesStatus && matchesShift && matchesStation;
  }), [filters, staff]);
  const assignedTableIds = useMemo(() => new Set(staff.flatMap((member) => member.assignedTables.map((table) => table.id))), [staff]);
  const unassignedTables = (snapshot?.tables ?? []).filter((table) => !assignedTableIds.has(table.id));
  const waiters = staff.filter((member) => member.role === "waiter" && member.active);
  const availableWaiters = waiters.filter((member) => member.assignedTables.length < 5);
  const busyWaiters = waiters.filter((member) => member.assignedTables.length >= 5);
  const kitchenStaff = staff.filter((member) => member.role === "kitchen" && member.active);
  const unassignedChefs = kitchenStaff.filter((member) => !member.assignedKitchenStationId);
  const stationWorkloads = (snapshot?.stations ?? []).map((station) => ({
    ...station,
    chefs: kitchenStaff.filter((member) => member.assignedKitchenStationId === station.id),
    workload: kitchenStaff.filter((member) => member.assignedKitchenStationId === station.id).reduce((sum, member) => sum + member.currentWorkload, 0),
  }));

  async function runAction(action: () => Promise<unknown>, success: string) {
    try {
      setNotice(null);
      setError(null);
      const response = await action();
      const temporaryPassword = response && typeof response === "object" ? (response as { temporaryPassword?: string }).temporaryPassword : null;
      setNotice(temporaryPassword ? `${success} Temporary password: ${temporaryPassword}` : success);
      await refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Staff action failed.");
    }
  }

  async function submitCreateStaff(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (wizardStep < 4) {
      setWizardStep(wizardStep + 1);
      return;
    }
    await runAction(() => createManagerStaff(restaurantId, {
      ...form,
      email: form.email || undefined,
      assignedKitchenStationId: form.role === "kitchen" ? form.assignedKitchenStationId : null,
    }), "Staff account created.");
    setCreateOpen(false);
    setActiveTab("directory");
  }

  async function assignSelectedTables(staffMember: ManagerStaffMember) {
    const input = window.prompt("Enter table numbers to assign, separated by commas.", staffMember.assignedTables.map((table) => table.tableNumber).join(", "));
    if (input === null) return;
    const requested = input.split(",").map((value) => Number(value.trim())).filter((value) => Number.isFinite(value));
    const tableIds = (snapshot?.tables ?? []).filter((table) => requested.includes(table.tableNumber)).map((table) => table.id);
    await runAction(() => assignWaiterTables(restaurantId, staffMember.id, tableIds), "Waiter table assignment updated.");
  }

  async function assignWaiterDraft() {
    if (!assignmentDraft.waiterId || assignmentDraft.tableIds.length === 0) return;
    await runAction(() => assignWaiterTables(restaurantId, assignmentDraft.waiterId, assignmentDraft.tableIds), "Waiter table assignment updated.");
  }

  async function assignSingleTable(waiterId: string, tableId: string) {
    const waiter = staff.find((member) => member.id === waiterId);
    if (waiter?.role !== "waiter") return;
    const nextIds = Array.from(new Set([...(waiter?.assignedTables.map((table) => table.id) ?? []), tableId]));
    await runAction(() => assignWaiterTables(restaurantId, waiterId, nextIds), "Waiter table assignment updated.");
  }

  async function moveTableToWaiter(waiterId: string, tableId: string) {
    await assignSingleTable(waiterId, tableId);
    setDragTableId(null);
  }

  async function moveChefToStation(staffId: string, stationId: string) {
    if (staff.find((member) => member.id === staffId)?.role !== "kitchen") return;
    await runAction(() => updateManagerStaff(restaurantId, staffId, { role: "kitchen", assignedKitchenStationId: stationId }), "Kitchen station assignment updated.");
  }

  async function assignKitchenDraft() {
    if (!assignmentDraft.kitchenStaffId || !assignmentDraft.stationId) return;
    await runAction(() => updateManagerStaff(restaurantId, assignmentDraft.kitchenStaffId, { role: "kitchen", assignedKitchenStationId: assignmentDraft.stationId }), "Kitchen station assignment updated.");
  }

  async function bulk(action: "activate" | "deactivate" | "announcement") {
    const targets = staff.filter((member) => selectedIds.includes(member.id));
    if (targets.length === 0) return;
    if (action === "announcement") {
      const text = window.prompt("Announcement to selected staff:");
      if (!text) return;
      await runAction(() => Promise.all(targets.map((member) => sendManagerStaffMessage(restaurantId, member.id, text, true))), "Announcement sent.");
      return;
    }
    await runAction(() => Promise.all(targets.map((member) => action === "activate" ? activateManagerStaff(restaurantId, member.id) : deactivateManagerStaff(restaurantId, member.id))), "Bulk action completed.");
  }

  return (
    <main className="mso-page">
      <header className="manager-module-header mso-header">
        <div>
          <span>Staff Operations</span>
          <h1>Staff Management</h1>
        </div>
        <p>{managerName} - Restaurant-scoped manager access</p>
      </header>

      <nav className="manager-tabs" aria-label="Staff module sections">
        {STAFF_TABS.map(([key, label]) => (
          <button key={key} type="button" className={activeTab === key ? "active" : ""} onClick={() => {
            setActiveTab(key);
            if (key === "create") setCreateOpen(true);
          }}>{label}</button>
        ))}
      </nav>
      <label className="manager-tab-select">
        <span>Staff section</span>
        <select value={activeTab} onChange={(event) => {
          const next = event.target.value as StaffTab;
          setActiveTab(next);
          if (next === "create") setCreateOpen(true);
        }}>
          {STAFF_TABS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>

      <section className="mso-toolbar">
        <input value={filters.name} onChange={(event) => setFilters({ ...filters, name: event.target.value })} placeholder="Filter by name" />
        <input value={filters.employeeId} onChange={(event) => setFilters({ ...filters, employeeId: event.target.value })} placeholder="Employee ID" />
        <select value={filters.role} onChange={(event) => setFilters({ ...filters, role: event.target.value })}>
          <option value="all">All roles</option>
          {ROLE_OPTIONS.filter((role) => role.enabled).map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
        </select>
        <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <select value={filters.shift} onChange={(event) => setFilters({ ...filters, shift: event.target.value })}>
          <option value="all">All shifts</option>
          <option value="on_shift">On shift</option>
          <option value="off_shift">Off shift</option>
        </select>
        <select value={filters.station} onChange={(event) => setFilters({ ...filters, station: event.target.value })}>
          <option value="all">All stations</option>
          {(snapshot?.stations ?? []).map((station) => <option value={station.id} key={station.id}>{station.name}</option>)}
        </select>
      </section>

      {(notice || error || loading) && <div className={`mso-message ${error ? "error" : ""}`}>{error || notice || "Loading staff operations..."}</div>}

      <section className={`mso-layout mso-tab-${activeTab}`}>
        {activeTab === "directory" && (
        <section className="mso-directory">
          <div className="mso-card-heading">
            <div><span>Directory</span><h2>Staff</h2></div>
            <div className="mso-bulk">
              <button type="button" onClick={() => void bulk("activate")}>Activate selected</button>
              <button type="button" onClick={() => void bulk("deactivate")}>Deactivate selected</button>
              <button type="button" onClick={() => void bulk("announcement")}>Send announcement</button>
            </div>
          </div>
          <div className="mso-table-wrap">
            <table className="mso-table">
              <thead>
                <tr>
                  <th>Select</th><th>Staff</th><th>Role</th><th>Shift</th><th>Assignments</th><th>Workload</th><th>Activity</th><th>Online</th>
                </tr>
              </thead>
              <tbody>
                {filteredStaff.map((member) => (
                  <tr key={member.id} className={selectedStaff?.id === member.id ? "selected" : ""} onClick={() => setSelectedStaffId(member.id)}>
                    <td data-label="Select"><input type="checkbox" checked={selectedIds.includes(member.id)} onChange={(event) => setSelectedIds(event.target.checked ? [...selectedIds, member.id] : selectedIds.filter((id) => id !== member.id))} onClick={(event) => event.stopPropagation()} /></td>
                    <td data-label="Staff"><div className="mso-person"><span>{member.avatarInitials}</span><div><strong>{member.fullName}</strong><small>{member.employeeId}</small></div></div></td>
                    <td data-label="Role"><span className={`mso-role-badge ${member.role}`}>{roleLabel(member.role)}</span></td>
                    <td data-label="Shift"><b className={member.shiftStatus}>{member.shiftStatus === "on_shift" ? "On shift" : "Off shift"}</b><small>{fmtDate(member.clockIn)} / {fmtDate(member.clockOut)}</small></td>
                    <td data-label="Assignments">{member.role === "waiter" ? member.assignedTables.map((table) => table.label).join(", ") || "No tables" : member.assignedKitchenStationName || "No station"}</td>
                    <td data-label="Workload">{member.currentWorkload} current - {member.activeOrders} orders</td>
                    <td data-label="Activity">{fmtDate(member.lastActivity)}</td>
                    <td data-label="Online"><span className={`mso-dot ${member.online ? "online" : ""}`} />{member.online ? "Online" : "Offline"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        )}

        {activeTab === "assignments" && (
        <aside className="mso-side mso-assignment-workspace">
          <section className="mso-assignment-kpis">
            <article><span>Unassigned Tables</span><strong>{unassignedTables.length}</strong><small>{unassignedTables.length ? "Needs coverage" : "Fully covered"}</small></article>
            <article><span>Available Waiters</span><strong>{availableWaiters.length}</strong><small>Fewer than 5 tables</small></article>
            <article><span>Busy Waiters</span><strong>{busyWaiters.length}</strong><small>5 or more tables</small></article>
            <article><span>Chefs On Shift</span><strong>{kitchenStaff.filter((member) => member.online).length}</strong><small>{unassignedChefs.length} without station</small></article>
            <article><span>Station Coverage</span><strong>{stationWorkloads.filter((station) => station.chefs.length > 0).length}/{stationWorkloads.length}</strong><small>Stations with chefs</small></article>
            <article><span>Shift Balance</span><strong>{staff.filter((member) => member.shiftStatus === "on_shift").length}/{staff.filter((member) => member.active).length}</strong><small>Active staff on shift</small></article>
          </section>
          <section className="mso-panel mso-assignment-overview">
            <div className="mso-card-heading"><div><span>Floor Coverage</span><h2>Available & Busy Waiters</h2></div><small>Drag a waiter to a table, or a table between waiters</small></div>
            <div className="mso-workload-grid">
              {waiters.map((waiter) => (
                <article key={waiter.id} className={waiter.assignedTables.length >= 5 ? "is-busy" : "is-available"} draggable onDragStart={() => { setDragStaffId(waiter.id); setDragTableId(null); }} onDragOver={(event) => event.preventDefault()} onDrop={() => dragTableId && void moveTableToWaiter(waiter.id, dragTableId)}>
                  <div><strong>{waiter.fullName}</strong><b>{waiter.assignedTables.length >= 5 ? "Busy" : "Available"}</b></div>
                  <span>{waiter.assignedTables.length} tables · {waiter.activeOrders} orders · {waiter.online ? "On shift" : "Off shift"}</span>
                  <progress max={8} value={Math.min(8, waiter.assignedTables.length)} />
                  <div className="mso-waiter-tables">{waiter.assignedTables.map((table) => <button key={table.id} type="button" draggable onDragStart={(event) => { event.stopPropagation(); setDragTableId(table.id); setDragStaffId(null); }}>{table.label}</button>)}{waiter.assignedTables.length === 0 && <small>Drop a table here</small>}</div>
                </article>
              ))}
              {waiters.length === 0 && <p className="mso-note">No active waiters available for assignment.</p>}
            </div>
          </section>

          <section className="mso-panel">
            <div className="mso-card-heading"><div><span>Unassigned Tables</span><h2>Drag waiter here or quick assign</h2></div></div>
            <div className="mso-table-chip-grid">
              {unassignedTables.map((table) => (
                <button key={table.id} type="button" onDragOver={(event) => event.preventDefault()} onDrop={() => dragStaffId && void assignSingleTable(dragStaffId, table.id)}>
                  {table.label}
                </button>
              ))}
              {unassignedTables.length === 0 && <p className="mso-note">All active tables have waiter coverage.</p>}
            </div>
          </section>

          <section className="mso-panel">
            <div className="mso-card-heading"><div><span>Waiter Assignment</span><h2>Assign or Move Tables</h2></div></div>
            <div className="mso-assignment-grid">
              <label>Waiter<select value={assignmentDraft.waiterId} onChange={(event) => setAssignmentDraft({ ...assignmentDraft, waiterId: event.target.value })}><option value="">Choose waiter</option>{staff.filter((member) => member.role === "waiter" && member.active).map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}</select></label>
              <label>Tables<select multiple value={assignmentDraft.tableIds} onChange={(event) => setAssignmentDraft({ ...assignmentDraft, tableIds: Array.from(event.target.selectedOptions).map((option) => option.value) })}>{(snapshot?.tables ?? []).map((table) => <option key={table.id} value={table.id}>{table.label}</option>)}</select></label>
              <button type="button" onClick={() => void assignWaiterDraft()}>Assign Waiter</button>
            </div>
          </section>

          <section className="mso-panel">
            <div className="mso-card-heading"><div><span>Chef Assignment</span><h2>Kitchen Stations</h2></div></div>
            <div className="mso-assignment-grid">
              <label>Kitchen staff<select value={assignmentDraft.kitchenStaffId} onChange={(event) => setAssignmentDraft({ ...assignmentDraft, kitchenStaffId: event.target.value })}><option value="">Choose chef</option>{staff.filter((member) => member.role === "kitchen" && member.active).map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}</select></label>
              <label>Station<select value={assignmentDraft.stationId} onChange={(event) => setAssignmentDraft({ ...assignmentDraft, stationId: event.target.value })}><option value="">Choose station</option>{(snapshot?.stations ?? []).map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}</select></label>
              <button type="button" onClick={() => void assignKitchenDraft()}>Move Chef</button>
            </div>
          </section>

          <section className="mso-panel">
            <div className="mso-card-heading"><div><span>Kitchen Coverage</span><h2>Stations & Chef Workload</h2></div><small>Station capacity is not configured in the backend</small></div>
            {unassignedChefs.length > 0 && <div className="mso-unassigned-chefs"><span>Unassigned chefs</span>{unassignedChefs.map((chef) => <button key={chef.id} type="button" draggable onDragStart={() => { setDragStaffId(chef.id); setDragTableId(null); }}>{chef.fullName}</button>)}</div>}
            <div className="mso-station-workload">
              {stationWorkloads.map((station) => (
                <article key={station.id} onDragOver={(event) => event.preventDefault()} onDrop={() => dragStaffId && void moveChefToStation(dragStaffId, station.id)}>
                  <div><strong>{station.name}</strong><span>{station.workload} queued · {station.chefs.length} chef{station.chefs.length === 1 ? "" : "s"}</span><small>{station.chefs.length ? "Covered" : "No chef coverage"}</small></div>
                  <div className="mso-chef-list">
                    {station.chefs.map((chef) => <button key={chef.id} type="button" draggable onDragStart={() => { setDragStaffId(chef.id); setDragTableId(null); }}>{chef.fullName}<small>{chef.currentWorkload} queued</small></button>)}
                    {station.chefs.length === 0 && <small>No chef assigned</small>}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="mso-panel">
            <div className="mso-card-heading"><div><span>Cashier Coverage</span><h2>POS Staff</h2></div></div>
            <div className="mso-workload-grid">
              {staff.filter((member) => member.role === "cashier" && member.active).map((cashier) => (
                <article key={cashier.id}>
                  <strong>{cashier.fullName}</strong>
                  <span>{cashier.online ? "Online" : "Offline"} · {cashier.shiftStatus === "on_shift" ? "On shift" : "Off shift"}</span>
                  <progress max={8} value={Math.min(8, cashier.activeOrders)} />
                </article>
              ))}
              {staff.filter((member) => member.role === "cashier" && member.active).length === 0 && <p className="mso-note">No active cashiers are currently available.</p>}
            </div>
          </section>

          {selectedStaff && <section className="mso-panel">
            <div className="mso-card-heading"><div><span>Selected staff</span><h2>{selectedStaff.fullName}</h2></div></div>
            <div className="mso-action-grid">
              <button type="button" onClick={() => void runAction(() => activateManagerStaff(restaurantId, selectedStaff.id), "Staff activated.")}>Activate</button>
              <button type="button" onClick={() => void runAction(() => deactivateManagerStaff(restaurantId, selectedStaff.id), "Staff deactivated.")}>Deactivate</button>
              <button type="button" onClick={() => void runAction(() => suspendManagerStaff(restaurantId, selectedStaff.id), "Staff suspended.")}>Suspend</button>
              <button type="button" onClick={() => void runAction(() => resetManagerStaffPassword(restaurantId, selectedStaff.id), selectedStaff.role === "waiter" ? "PIN reset." : "Temporary password generated.")}>{selectedStaff.role === "waiter" ? "Reset PIN" : "Reset password"}</button>
              <button type="button" onClick={() => void runAction(() => markManagerStaffBreak(restaurantId, selectedStaff.id), "Break started.")}>Mark break</button>
              <button type="button" onClick={() => void runAction(() => endManagerStaffBreak(restaurantId, selectedStaff.id), "Break ended.")}>End break</button>
              {selectedStaff.role === "waiter" && <button type="button" onClick={() => void assignSelectedTables(selectedStaff)}>Assign tables</button>}
            </div>
            {selectedStaff.role === "kitchen" && <select value={selectedStaff.assignedKitchenStationId ?? ""} onChange={(event) => void runAction(() => updateManagerStaff(restaurantId, selectedStaff.id, { role: "kitchen", assignedKitchenStationId: event.target.value }), "Kitchen station updated.")}><option value="">Move station</option>{(snapshot?.stations ?? []).map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}</select>}
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Announcement or notification" />
            <div className="mso-action-row"><button type="button" onClick={() => void runAction(() => sendManagerStaffMessage(restaurantId, selectedStaff.id, message, true), "Announcement sent.")}>Send announcement</button><button type="button" onClick={() => void runAction(() => sendManagerStaffMessage(restaurantId, selectedStaff.id, message, false), "Notification sent.")}>Send notification</button></div>
          </section>}
        </aside>
        )}

        {activeTab === "activity" && (
        <aside className="mso-side">
          <section className="mso-panel">
            <div className="mso-card-heading"><div><span>Activity Timeline</span><h2>Recent</h2></div></div>
            <div className="mso-timeline">
              {(snapshot?.activity ?? []).map((entry) => <article key={entry.id}><span /><div><strong>{activityLabel(entry.action)}</strong><small>{fmtDate(entry.createdAt)} - {entry.targetStaffEmail || "Restaurant staff"}</small></div></article>)}
            </div>
          </section>
        </aside>
        )}

        {activeTab === "analytics" && (
          <section className="mso-directory">
            <div className="mso-card-heading"><div><span>Analytics</span><h2>Workload Summary</h2></div></div>
            <div className="mso-action-grid">
              <article><strong>{staff.length}</strong><span>Total operational staff</span></article>
              <article><strong>{staff.filter((member) => member.online).length}</strong><span>Online</span></article>
              <article><strong>{staff.filter((member) => member.shiftStatus === "on_shift").length}</strong><span>On shift</span></article>
              <article><strong>{staff.reduce((sum, member) => sum + member.activeOrders, 0)}</strong><span>Active orders</span></article>
            </div>
          </section>
        )}
      </section>

      {createOpen && (
        <div className="mso-modal-layer" role="presentation" onClick={() => setCreateOpen(false)}>
          <form className="mso-panel mso-create-modal" onSubmit={(event) => void submitCreateStaff(event)} onClick={(event) => event.stopPropagation()}>
            <div className="mso-card-heading"><div><span>Create Staff Wizard</span><h2>Step {wizardStep} of 4</h2></div></div>
            <div className="mso-stepper"><span className={wizardStep >= 1 ? "active" : ""}>Role</span><span className={wizardStep >= 2 ? "active" : ""}>Info</span><span className={wizardStep >= 3 ? "active" : ""}>Assignment</span><span className={wizardStep >= 4 ? "active" : ""}>Review</span></div>

            {wizardStep === 1 && <div className="mso-role-grid">
              <button type="button" className={form.role === "waiter" ? "selected" : ""} onClick={() => setForm({ ...form, role: "waiter" })}>Waiter</button>
              <button type="button" className={form.role === "cashier" ? "selected" : ""} onClick={() => setForm({ ...form, role: "cashier" })}>Cashier</button>
              <button type="button" className={form.role === "kitchen" ? "selected" : ""} onClick={() => setForm({ ...form, role: "kitchen" })}>Kitchen</button>
              <button type="button" className={form.role === "inventory_officer" ? "selected" : ""} onClick={() => setForm({ ...form, role: "inventory_officer" })}>Inventory Officer</button>
            </div>}

            {wizardStep === 2 && <>
              <input required value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} placeholder="Full name" />
              <input required type="password" inputMode={form.role === "waiter" ? "numeric" : "text"} pattern={form.role === "waiter" ? "[0-9]{4}" : undefined} maxLength={form.role === "waiter" ? 4 : 64} value={form.pinPassword} onChange={(event) => setForm({ ...form, pinPassword: form.role === "waiter" ? event.target.value.replace(/\D/g, "").slice(0, 4) : event.target.value })} placeholder={form.role === "waiter" ? "4-digit PIN" : "Temporary password"} />
              {form.role !== "waiter" && <input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="Work email" />}
              <input value={form.phoneNumber} onChange={(event) => setForm({ ...form, phoneNumber: event.target.value })} placeholder="Phone number (optional)" />
            </>}

            {wizardStep === 3 && <>
              {form.role === "waiter" && <input value={form.section} onChange={(event) => setForm({ ...form, section: event.target.value })} placeholder="Assign section (optional)" />}
              {form.role === "kitchen" && <select required value={form.assignedKitchenStationId} onChange={(event) => setForm({ ...form, assignedKitchenStationId: event.target.value })}><option value="">Assign kitchen station</option>{(snapshot?.stations ?? []).map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}</select>}
              <input value={form.shift} onChange={(event) => setForm({ ...form, shift: event.target.value })} placeholder="Assign shift (optional)" />
            </>}

            {wizardStep === 4 && <div className="mso-review">
              <p><strong>Role</strong><span>{roleLabel(form.role)}</span></p>
              <p><strong>Full name</strong><span>{form.fullName || "Missing"}</span></p>
              <p><strong>Employee ID</strong><span>Generated automatically</span></p>
              <p><strong>Login</strong><span>{form.role === "waiter" ? "Name and PIN" : `${form.email || "Missing email"} and password`}</span></p>
              <p><strong>Assignment</strong><span>{form.role === "kitchen" ? (snapshot?.stations.find((station) => station.id === form.assignedKitchenStationId)?.name || "No station") : form.role === "cashier" ? (form.shift || "No shift") : (form.section || "No section")}</span></p>
            </div>}

            <div className="mso-wizard-actions">
              {wizardStep > 1 && <button type="button" onClick={() => setWizardStep(Math.max(1, wizardStep - 1))}>Back</button>}
              <button type="submit">{wizardStep === 4 ? "Review and Create Staff" : "Continue"}</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
