import { useEffect, useRef, useState, type ReactNode } from 'react';
import { loadOwnerMenuSalesReport, type MenuSalesReport } from '../services/ownerMenuSalesReport';
import type { OwnerReportsPeriodKey } from '../services/ownerReportsReadModel';
import { OWNER_RETAINED_POLICY, readOwnerRetainedResource, revalidateOwnerRetainedResource } from '../services/ownerRetainedResources';

export const menuSalesTitle = (period: OwnerReportsPeriodKey) => ({ today: "Today's Menu Sales", yesterday: "Yesterday's Menu Sales", week: "This Week's Menu Sales", month: "This Month's Menu Sales", custom: 'Menu Sales' })[period];
const money = (value: number, currency: string) => `${new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(value)} ${currency}`;

export function MenuSalesRows({ report }: { report: MenuSalesReport }) {
  const [soldLimit, setSoldLimit] = useState(50);
  const [noSalesLimit, setNoSalesLimit] = useState(50);
  return <>
    <p className="od-reports-help">Best sellers by quantity. Sales value uses the prices charged for each item.</p>
    {report.soldItems.length ? <table className="od-menu-sales-table"><thead><tr><th scope="col">#</th><th scope="col">Menu Item</th><th scope="col">Category</th><th scope="col">Quantity Sold</th><th scope="col">Sales Value</th><th scope="col">Share</th></tr></thead><tbody>
      {report.soldItems.slice(0, soldLimit).map(row => <tr key={row.rank}>
        <td data-label="Rank" className="od-menu-rank">#{row.rank}</td><th data-label="Menu Item" scope="row">{row.name}{row.archived && <small>Archived</small>}</th><td data-label="Category" className="od-menu-category">{row.category}</td>
        <td data-label="Quantity Sold">{row.quantity.toLocaleString('en')} sold</td><td data-label="Sales Value" className="od-menu-value">{money(row.itemLineSalesValue, report.currency)}<span className="od-menu-mobile-label"> sales value</span></td>
        <td data-label="Share">{row.salesSharePercent === null ? 'Share unavailable' : <>{row.salesSharePercent.toLocaleString('en', { maximumFractionDigits: 2 })}%<span className="od-menu-mobile-label"> of menu item sales</span><progress aria-label={`${row.name} share of menu item sales`} max={100} value={Math.max(0, Math.min(100, row.salesSharePercent))} /></>}</td>
      </tr>)}
    </tbody></table> : <p className="od-reports-empty">No menu items were sold in this period.</p>}
    {soldLimit < report.soldItems.length && <button type="button" className="od-reports-load-more" onClick={() => setSoldLimit(limit => limit + 50)}>Load More Menu Items</button>}
    <details className="od-menu-zero"><summary>{report.period.key === 'today' ? 'No Sales Today' : 'No Sales This Period'} ({report.noSalesItems.length})</summary><p>Items available on your menu now with no recorded sales in this period.</p>
      {report.noSalesItems.length ? <ul>{report.noSalesItems.slice(0, noSalesLimit).map(row => <li key={row.menuItemKey}><span>{row.name}<small>{row.category}</small></span><strong>0 sold</strong></li>)}</ul> : <p>No currently available items have zero recorded sales.</p>}
    </details>
    {noSalesLimit < report.noSalesItems.length && <button type="button" className="od-reports-load-more" onClick={() => setNoSalesLimit(limit => limit + 50)}>Load More No-Sale Items</button>}
    {report.unmatchedItemLineCount > 0 && <p className="od-reports-subtle-note">Some older sales could not be matched to the current menu. Their recorded sales value remains included.</p>}
    {report.legacyUnattributedItemCount > 0 && <p className="od-reports-subtle-note">Some older items have no payment date, so they cannot be assigned to this period.</p>}
    <p className="od-reports-help od-menu-definition">Names and categories reflect your current menu. Sales value excludes discounts, tax, service charges and refunds, so it differs from Money Collected.</p>
  </>;
}

export function OwnerMenuSalesReport({ ownerUserId, restaurantId, period, start, end, preview, defaultOpen = false, refreshToken = 0 }: { ownerUserId?: string; restaurantId: string; period: OwnerReportsPeriodKey; start: string | null; end: string | null; preview?: ReactNode; defaultOpen?: boolean; refreshToken?: number }) {
  const scope = ownerUserId ? { userId: ownerUserId, restaurantId } : null;
  const dimensions = JSON.stringify([period, start, end]);
  const retained = scope ? readOwnerRetainedResource<MenuSalesReport>({ scope, resource: 'reports-menu', dimensions, ...OWNER_RETAINED_POLICY.reports }) : null;
  const [report, setReport] = useState<MenuSalesReport | null>(retained?.value ?? null);
  const [open, setOpen] = useState(defaultOpen);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0); const busy = useRef(false);
  const load = async (force = false) => {
    if (busy.current) return;
    busy.current = true; const request = ++generation.current;
    setOpen(true); setLoading(true); setError(null);
    try { const loader = () => loadOwnerMenuSalesReport(restaurantId, period, start, end); const next = scope ? await revalidateOwnerRetainedResource({ scope, resource: 'reports-menu', dimensions, loader, afterPending: force }) : await loader(); if (request === generation.current) setReport(next); }
    catch { if (request === generation.current) setError('Could not load menu sales. Try again.'); }
    finally { if (request === generation.current) { busy.current = false; setLoading(false); } }
  };
  useEffect(() => { const cached=scope ? readOwnerRetainedResource<MenuSalesReport>({ scope, resource:'reports-menu', dimensions, ...OWNER_RETAINED_POLICY.reports }) : null; if(cached){setReport(cached.value);setOpen(defaultOpen||open);if(!cached.isStale&&!refreshToken)return;} if(defaultOpen||refreshToken)void load(refreshToken>0); return () => { generation.current++; busy.current=false; }; }, [dimensions, ownerUserId, restaurantId, refreshToken]); // eslint-disable-line react-hooks/exhaustive-deps
  return <section className="od-reports-panel od-menu-sales">
    <header className="od-reports-panel-header"><h2>{menuSalesTitle(period)}</h2><button type="button" className="od-menu-open" aria-expanded={open} disabled={loading} onClick={() => { if (open) setOpen(false); else if (report) setOpen(true); else void load(); }}>{loading ? 'Loading menu sales…' : open ? 'Show summary' : 'View full menu report'}</button></header>
    {!open && <><p className="od-reports-help">Highest-selling items by quantity. Open the full report for every recorded item.</p>{preview}</>}
    {open && loading && <p role="status">Loading menu sales…</p>}
    {open && error && <div role="alert"><p>{error}</p><button type="button" className="od-menu-open" onClick={() => void load()}>Try again</button></div>}
    {open && report && <><p className="od-reports-context">{new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: report.period.timezone }).format(new Date(report.period.currentStart))} – {new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: report.period.timezone }).format(new Date(Date.parse(report.period.currentEnd) - 1))}</p><MenuSalesRows key={`${restaurantId}:${dimensions}`} report={report} /></>}
  </section>;
}
