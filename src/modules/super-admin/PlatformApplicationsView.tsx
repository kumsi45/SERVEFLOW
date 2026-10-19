import { type AdminCursor, type AdminRow, type AdminResult } from "./platformAdminService";
import { StatusBadge } from "./PlatformAdminWorkspace";
import { DataTable, FilterChip, Pagination, SearchInput, Skeleton, type TableColumn } from "./PlatformAdminUI";

type Props = {
  rows: AdminRow[];
  result: AdminResult;
  search: string;
  onSearch: (value: string) => void;
  status: string;
  onStatus: (value: string) => void;
  pendingCount: number | null;
  cursor: AdminCursor | null;
  pageIndex: number;
  onFirst: () => void;
  onNext: () => void;
  onOpen: (row: AdminRow) => void;
  onApprove: (row: AdminRow) => void;
  onReject: (row: AdminRow) => void;
  canDecide: boolean;
  busy: boolean;
  loading: boolean;
};

const label = (row: AdminRow) => typeof row.business_name === "string" ? row.business_name : "Unnamed business";
const stamp = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Unavailable";

export function PlatformApplicationsView({ rows, result, search, onSearch, status, onStatus, pendingCount, cursor, pageIndex, onFirst, onNext, onOpen, onApprove, onReject, canDecide, busy, loading }: Props) {
  const columns: TableColumn<AdminRow>[] = [
    { key: "business", label: "Business", render: row => <button type="button" className="pa-application-link" title={label(row)} onClick={event => { event.stopPropagation(); onOpen(row); }}>{label(row)}</button> },
    { key: "type", label: "Type", render: row => typeof row.business_type === "string" ? row.business_type : "Unavailable" },
    { key: "status", label: "Status", render: row => <div className="pa-application-status"><StatusBadge value={row.status} />{row.status !== "pending" && <small>{typeof row.decided_by_name === "string" ? `${row.status === "approved" ? "Approved" : "Rejected"} by ${row.decided_by_name}` : "Reviewer unavailable"}{typeof row.decided_at === "string" && ` on ${stamp(row.decided_at)}`}</small>}</div> },
    { key: "submitted", label: "Submitted", render: row => <time title={new Date(row.created_at).toLocaleString()} dateTime={row.created_at}>{stamp(row.created_at)}</time> },
    { key: "actions", label: "Actions", render: row => row.status === "pending" && canDecide ? <div className="pa-application-actions"><button type="button" className="pa-primary" disabled={busy} onClick={event => { event.stopPropagation(); onApprove(row); }}>Approve</button><button type="button" className="pa-reject" disabled={busy} onClick={event => { event.stopPropagation(); onReject(row); }}>Reject</button></div> : <button type="button" onClick={event => { event.stopPropagation(); onOpen(row); }}>View details</button> },
  ];
  return <section className="pa-applications" aria-label="Applications">
    <div className="pa-application-filters"><div className="pa-filter-chips" aria-label="Application status">{(["pending", "approved", "rejected", ""] as const).map(value => <FilterChip key={value || "all"} active={status === value} count={value === "pending" ? pendingCount : null} onClick={() => onStatus(value)}>{value ? value[0].toUpperCase() + value.slice(1) : "All"}</FilterChip>)}</div><SearchInput id="pa-application-search" label="Search applications" placeholder="Search businesses or email" value={search} onChange={event => onSearch(event.target.value)} maxLength={100} /></div>
    <p className="pa-sort-note">Submitted: newest first</p>
    {loading ? <Skeleton /> : rows.length === 0 ? <div className="pa-ui-state"><h2>No applications found</h2><p>Try another status or search.</p></div> : <DataTable label="Application records" columns={columns} rows={rows} onOpen={onOpen} />}
    {(cursor || result.nextCursor) && <Pagination previousLabel="First page" start={pageIndex + 1} end={pageIndex + rows.length} total={null} size={rows.length} previous={cursor ? onFirst : undefined} next={result.nextCursor ? onNext : undefined} />}
  </section>;
}
