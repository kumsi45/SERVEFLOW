import { useEffect, useMemo, useState } from "react";
import type { ManagerWaiterAssignmentContext } from "../services/managerWaiterTableAssignmentService";
import "../styles/managerWaiterTableAssignments.css";

type Props = {
  context: ManagerWaiterAssignmentContext | null;
  state: "loading" | "ready" | "unavailable";
  syncNotice: string | null;
  requestedTableId: string | null;
  onRequestHandled: () => void;
  onAssign: (waiterId: string, tableIds: string[]) => Promise<void>;
  onUnassign: (tableIds: string[]) => Promise<void>;
};

function countLabel(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to assign tables.";
  if (/permission|not authorized|authentication/i.test(message)) return "Not authorized.";
  if (/active waiter|active restaurant tables|not found/i.test(message)) return "Assignment changed by another Manager. Refreshing...";
  return "Unable to assign tables.";
}

export function ManagerWaiterTableAssignments({ context, state, syncNotice, requestedTableId, onRequestHandled, onAssign, onUnassign }: Props) {
  const [open, setOpen] = useState(false);
  const [pendingWaiterId, setPendingWaiterId] = useState("");
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);
  const [seedTableId, setSeedTableId] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const waiters = context?.waiters ?? [];
  const tables = context?.tables ?? [];

  function beginAssignment(tableId: string | null = null, waiterId: string | null = null) {
    const table = tableId ? tables.find((candidate) => candidate.tableId === tableId) : null;
    const initialWaiterId = waiterId ?? table?.currentWaiterStaffId ?? "";
    const currentWaiterTables = initialWaiterId ? tables.filter((candidate) => candidate.currentWaiterStaffId === initialWaiterId).map((candidate) => candidate.tableId) : [];
    setSeedTableId(tableId);
    setPendingWaiterId(initialWaiterId);
    setSelectedTableIds(Array.from(new Set([...currentWaiterTables, ...(tableId ? [tableId] : [])])));
    setError(null);
    setOpen(true);
  }

  useEffect(() => {
    if (!requestedTableId || state !== "ready") return;
    beginAssignment(requestedTableId);
    onRequestHandled();
    // The request is an imperative bridge from the small Table Inspector action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedTableId, state]);

  const selectedWaiter = waiters.find((waiter) => waiter.staffId === pendingWaiterId) ?? null;
  const selectedTables = tables.filter((table) => selectedTableIds.includes(table.tableId));
  const reassignedTables = selectedWaiter ? selectedTables.filter((table) => table.currentWaiterStaffId && table.currentWaiterStaffId !== selectedWaiter.staffId) : [];
  const ownersLosingTables = useMemo(() => Array.from(new Set(reassignedTables.map((table) => table.currentWaiterName).filter(Boolean))), [reassignedTables]);
  const removedFromWaiter = selectedWaiter ? tables.filter((table) => table.currentWaiterStaffId === selectedWaiter.staffId && !selectedTableIds.includes(table.tableId)) : [];
  const assignedSelectedTables = selectedTables.filter((table) => table.currentWaiterStaffId);
  const unassignedTables = tables.filter((table) => !table.currentWaiterStaffId);

  function chooseWaiter(waiterId: string) {
    const currentTableIds = tables.filter((table) => table.currentWaiterStaffId === waiterId).map((table) => table.tableId);
    setPendingWaiterId(waiterId);
    setSelectedTableIds(Array.from(new Set([...currentTableIds, ...(seedTableId ? [seedTableId] : [])])));
    setError(null);
  }

  function toggleTable(tableId: string) {
    setSelectedTableIds((current) => current.includes(tableId) ? current.filter((id) => id !== tableId) : [...current, tableId]);
    setError(null);
  }

  async function assign() {
    if (!selectedWaiter || selectedTableIds.length === 0) return;
    try {
      setWorking(true); setError(null);
      await onAssign(selectedWaiter.staffId, selectedTableIds);
      setOpen(false);
    } catch (assignmentError) {
      setError(friendlyError(assignmentError));
    } finally { setWorking(false); }
  }

  async function unassign() {
    const tableIds = assignedSelectedTables.map((table) => table.tableId);
    if (tableIds.length === 0) return;
    try {
      setWorking(true); setError(null);
      await onUnassign(tableIds);
      setOpen(false);
    } catch (assignmentError) {
      setError(friendlyError(assignmentError));
    } finally { setWorking(false); }
  }

  if (state === "loading") return <section className="moc-panel mwta-shell" aria-label="Table assignments"><div className="moc-empty" role="status"><strong>Loading table assignments...</strong></div></section>;
  if (state === "unavailable") return <section className="moc-panel mwta-shell" aria-label="Table assignments"><div className="moc-message error" role="alert">Table assignments unavailable.</div></section>;
  if (tables.length === 0) return null;

  return <>
    <section className="moc-panel mwta-shell" aria-labelledby="table-assignments-title">
      <div className="mwta-heading"><div><span>Current responsibility</span><h2 id="table-assignments-title">Table Assignments</h2><p>Assign operational table responsibility without changing occupancy or existing orders.</p></div><button type="button" onClick={() => beginAssignment()}>Assign Tables</button></div>
      {syncNotice && <p className="mwta-sync" role="status">{syncNotice}</p>}
      <div className="mwta-board">
        {waiters.map((waiter) => { const waiterTables = tables.filter((table) => table.currentWaiterStaffId === waiter.staffId); return <article className="mwta-waiter" key={waiter.staffId}>
          <header><span><strong>{waiter.displayName}</strong><small>{countLabel(waiterTables.length, "table")}</small></span><button type="button" onClick={() => beginAssignment(null, waiter.staffId)}>Manage</button></header>
          <div className="mwta-table-chips">{waiterTables.map((table) => <span key={table.tableId}><b>{table.tableLabel}</b><small>{table.occupancyStatus === "occupied" ? "Occupied" : "Available"}</small></span>)}{waiterTables.length === 0 && <em>No tables assigned yet.</em>}</div>
        </article>; })}
        {waiters.length === 0 && <div className="moc-empty"><strong>No Waiters available.</strong><span>Create or activate a Waiter before assigning tables.</span></div>}
        <article className="mwta-waiter mwta-unassigned"><header><span><strong>Unassigned Tables</strong><small>{countLabel(unassignedTables.length, "table")}</small></span>{unassignedTables.length > 0 && <button type="button" onClick={() => beginAssignment(unassignedTables[0].tableId)}>Assign</button>}</header><div className="mwta-table-chips">{unassignedTables.map((table) => <span key={table.tableId}><b>{table.tableLabel}</b><small>{table.occupancyStatus === "occupied" ? "Occupied" : "Available"}</small></span>)}{unassignedTables.length === 0 && <em>All tables have a responsible Waiter.</em>}</div></article>
      </div>
    </section>

    {open && <div className="mwta-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) setOpen(false); }}><section className="mwta-dialog" role="dialog" aria-modal="true" aria-labelledby="mwta-dialog-title">
      <header><div><span>Table Assignments</span><h2 id="mwta-dialog-title">Assign Tables</h2><p>Choose a Waiter, then select one or more tables.</p></div><button type="button" aria-label="Close table assignment" disabled={working} onClick={() => setOpen(false)}>×</button></header>
      <div className="mwta-dialog-body">
        <section className="mwta-step"><div className="mwta-step-title"><b>1</b><span><strong>Select Waiter</strong><small>Active Waiters only</small></span></div><label><span className="sr-only">Select Waiter</span><select value={pendingWaiterId} onChange={(event) => chooseWaiter(event.target.value)} disabled={working}><option value="">Select Waiter</option>{waiters.map((waiter) => <option key={waiter.staffId} value={waiter.staffId}>{waiter.displayName} — {countLabel(waiter.assignedTableCount, "table")}</option>)}</select></label>{waiters.length === 0 && <p className="mwta-inline-empty">No Waiters available.</p>}</section>
        <section className="mwta-step"><div className="mwta-step-title"><b>2</b><span><strong>Select Tables</strong><small>{countLabel(selectedTableIds.length, "table")} selected</small></span></div><div className="mwta-table-options">{tables.map((table) => <label key={table.tableId} className={selectedTableIds.includes(table.tableId) ? "selected" : ""}><input type="checkbox" checked={selectedTableIds.includes(table.tableId)} onChange={() => toggleTable(table.tableId)} disabled={working} /><span><strong>{table.tableLabel}</strong><small><em className={table.occupancyStatus}>{table.occupancyStatus === "occupied" ? "Occupied" : "Available"}</em>{table.currentWaiterName ? `Currently assigned to ${table.currentWaiterName}` : "Unassigned"}</small></span></label>)}</div></section>
        {selectedWaiter && <section className="mwta-summary" aria-live="polite"><strong>{countLabel(selectedTableIds.length, "table")} will be assigned to {selectedWaiter.displayName}.</strong>{reassignedTables.length > 0 && <p>{countLabel(reassignedTables.length, "table")} currently {reassignedTables.length === 1 ? "belongs" : "belong"} to {ownersLosingTables.join(", ")}. This changes current responsibility only.</p>}{removedFromWaiter.length > 0 && <p>{countLabel(removedFromWaiter.length, "table")} will move to Unassigned.</p>}<small>Existing orders, payments, kitchen state, and table occupancy will remain unchanged.</small></section>}
        {error && <p className="mwta-error" role="alert">{error}</p>}
      </div>
      <footer><button type="button" className="secondary" disabled={working} onClick={() => setOpen(false)}>Cancel</button><button type="button" className="unassign" disabled={working || assignedSelectedTables.length === 0} onClick={() => void unassign()}>Move selected to Unassigned</button><button type="button" disabled={working || !selectedWaiter || selectedTableIds.length === 0} onClick={() => void assign()}>{working ? "Saving..." : reassignedTables.length > 0 ? "Confirm Assignment" : `Assign ${countLabel(selectedTableIds.length, "Table")}`}</button></footer>
    </section></div>}
  </>;
}
