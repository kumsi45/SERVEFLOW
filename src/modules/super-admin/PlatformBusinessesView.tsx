import type { AdminCursor, AdminResult, AdminRow } from "./platformAdminService";
import { StatusBadge } from "./PlatformAdminWorkspace";
import { DataTable, FilterChip, Pagination, SearchInput, Tooltip, type TableColumn } from "./PlatformAdminUI";

type Props = {
  rows: AdminRow[]; result: AdminResult; search: string; onSearch: (value: string) => void;
  status: string; onStatus: (value: string) => void; cursor: AdminCursor | null; pageIndex: number;
  onFirst: () => void; onNext: () => void; onOpen: (row: AdminRow) => void; onClassify: (row: AdminRow) => void; canManage: boolean;
};
const name = (row: AdminRow) => typeof row.name === "string" ? row.name : "Unnamed business";
const owner = (row: AdminRow) => Array.isArray(row.owners) ? row.owners.map(item => typeof item === "object" && item ? String((item as Record<string, unknown>).name ?? "") : "").filter(Boolean).join(", ") || "Unassigned" : "Unassigned";
const created = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Unavailable";

export function PlatformBusinessesView({ rows, result, search, onSearch, status, onStatus, cursor, pageIndex, onFirst, onNext, onOpen, onClassify, canManage }: Props) {
  const columns: TableColumn<AdminRow>[] = [
    { key: "business", label: "Business", render: row => <button type="button" className="pa-application-link" title={name(row)} onClick={event => { event.stopPropagation(); onOpen(row); }}>{name(row)}</button> },
    { key: "status", label: "Status", render: () => <StatusBadge value="Unknown" /> },
    { key: "classification", label: "Classification", render: row => <StatusBadge value={row.classification} /> },
    { key: "owner", label: "Owner", render: row => owner(row), mobile: false },
    { key: "created", label: "Created", render: row => <time dateTime={row.created_at} title={new Date(row.created_at).toLocaleString()}>{created(row.created_at)}</time>, mobile: false },
    { key: "actions", label: "Actions", render: row => <div className="pa-business-actions">{row.classification === "unclassified" && canManage && <button type="button" onClick={event => { event.stopPropagation(); onClassify(row); }}>Review classification</button>}<Tooltip text="Suspension needs server enforcement."><button type="button" disabled>Suspend</button></Tooltip><Tooltip text="Restoration needs server enforcement."><button type="button" disabled>Restore</button></Tooltip></div> },
  ];
  return <section className="pa-businesses" aria-label="Businesses">
    <div className="pa-application-filters"><div className="pa-filter-chips" aria-label="Business classification">{(["", "live", "demo", "unclassified"] as const).map(value => <FilterChip key={value || "all"} active={status === value} onClick={() => onStatus(value)}>{value ? value[0].toUpperCase() + value.slice(1) : "All"}</FilterChip>)}</div><SearchInput id="pa-business-search" label="Search businesses" placeholder="Search businesses" value={search} onChange={event => onSearch(event.target.value)} maxLength={100} /></div>
    <p className="pa-classification-hint"><Tooltip text="A reviewed label, not a paid entitlement.">Classification</Tooltip> is reviewed separately from billing and access enforcement.</p>
    {rows.length === 0 ? <div className="pa-ui-state"><p>No businesses match these filters.</p></div> : <DataTable label="Business records" columns={columns} rows={rows} onOpen={onOpen} />}
    {(cursor || result.nextCursor) && <Pagination previousLabel="First page" start={pageIndex + 1} end={pageIndex + rows.length} total={null} size={rows.length} previous={cursor ? onFirst : undefined} next={result.nextCursor ? onNext : undefined} />}
  </section>;
}
