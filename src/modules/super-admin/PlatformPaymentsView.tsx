import type { AdminCursor, AdminResult, AdminRow } from "./platformAdminService";
import { StatusBadge } from "./PlatformAdminWorkspace";
import { DataTable, FilterChip, Pagination, RefreshButton, SearchInput, type TableColumn } from "./PlatformAdminUI";

type Props = {
  rows: AdminRow[]; result: AdminResult; search: string; onSearch: (value: string) => void; status: string; onStatus: (value: string) => void;
  cursor: AdminCursor | null; pageIndex: number; onFirst: () => void; onNext: () => void; onOpen: (row: AdminRow) => void; onReject: (row: AdminRow) => void; canReview: boolean; onRefresh: () => void; loading: boolean;
};
const text = (value: unknown) => value == null || value === "" ? "Unavailable" : String(value);
const amount = (row: AdminRow) => typeof row.amount === "number" && typeof row.currency === "string" ? new Intl.NumberFormat(undefined, { style: "currency", currency: row.currency }).format(row.amount) : "Unavailable";
const when = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Unavailable";
const label = (value: string) => value === "pending" ? "Needs review" : value === "approved" ? "Confirmed" : value ? value[0].toUpperCase() + value.slice(1) : "All";

export function PlatformPaymentsView({ rows, result, search, onSearch, status, onStatus, cursor, pageIndex, onFirst, onNext, onOpen, onReject, canReview, onRefresh, loading }: Props) {
  const columns: TableColumn<AdminRow>[] = [
    { key: "business", label: "Business", render: row => <button type="button" className="pa-application-link" onClick={() => onOpen(row)}>{text(row.business_name)}</button> },
    { key: "amount", label: "Amount", render: amount },
    { key: "channel", label: "Channel", render: row => text(row.channel), mobile: false },
    { key: "status", label: "Status", render: row => <StatusBadge value={row.status} /> },
    { key: "submitted", label: "Submitted", sort: "descending", render: row => <time dateTime={String(row.created_at)} title={new Date(String(row.created_at)).toLocaleString()}>{when(row.created_at)}</time>, mobile: false },
    { key: "actions", label: "Actions", render: row => row.status === "pending" && canReview ? <button type="button" className="pa-reject" onClick={event => { event.stopPropagation(); onReject(row); }}>Reject</button> : <button type="button" onClick={event => { event.stopPropagation(); onOpen(row); }}>View evidence</button> },
  ];
  return <section className="pa-payments-view" aria-label="Payment reviews">
    <div className="pa-application-filters"><div className="pa-filter-chips" aria-label="Payment status">{(["pending", "approved", "rejected", ""] as const).map(value => <FilterChip key={value || "all"} active={status === value} onClick={() => onStatus(value)}>{label(value)}</FilterChip>)}</div><SearchInput id="pa-payment-search" label="Search payments" placeholder="Search payments" value={search} onChange={event => onSearch(event.target.value)} maxLength={100} /><RefreshButton onClick={onRefresh} disabled={loading} /></div>
    <p className="pa-classification-hint">Payments are never auto-confirmed.</p>
    {rows.length === 0 ? <div className="pa-ui-state"><p>No payments match these filters.</p></div> : <DataTable label="Payment evidence" columns={columns} rows={rows} onOpen={onOpen} />}
    {(cursor || result.nextCursor) && <Pagination previousLabel="First page" start={pageIndex + 1} end={pageIndex + rows.length} total={null} size={rows.length} previous={cursor ? onFirst : undefined} next={result.nextCursor ? onNext : undefined} />}
  </section>;
}
