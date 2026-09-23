import { useEffect, useRef, useState, type ReactNode } from 'react';
import { loadOwnerMenuSalesReport, type MenuSalesReport } from '../services/ownerMenuSalesReport';
import type { OwnerReportsPeriodKey } from '../services/ownerReportsReadModel';

export const menuSalesTitle = (period: OwnerReportsPeriodKey) => ({ today: "Today's Menu Sales", yesterday: "Yesterday's Menu Sales", week: "This Week's Menu Sales", month: "This Month's Menu Sales", custom: 'Menu Sales' })[period];
const money = (value: number, currency: string) => `${new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(value)} ${currency}`;

export function MenuSalesRows({ report }: { report: MenuSalesReport }) {
  return <>
    <p className="od-reports-help">Ranked by quantity sold. Sales value uses recorded item prices before payment adjustments.</p>
    {report.soldItems.length ? <table className="od-menu-sales-table"><thead><tr><th scope="col">#</th><th scope="col">Menu Item</th><th scope="col">Category</th><th scope="col">Quantity Sold</th><th scope="col">Sales Value</th><th scope="col">Share</th></tr></thead><tbody>
      {report.soldItems.map(row => <tr key={row.rank}>
        <td className="od-menu-rank">#{row.rank}</td><th scope="row">{row.name}{row.archived && <small>Archived</small>}</th><td className="od-menu-category">{row.category}</td>
        <td>{row.quantity.toLocaleString('en')} sold</td><td className="od-menu-value">{money(row.itemLineSalesValue, report.currency)}<span className="od-menu-mobile-label"> sales value</span></td>
        <td>{row.salesSharePercent === null ? 'Share unavailable' : <>{row.salesSharePercent.toLocaleString('en', { maximumFractionDigits: 2 })}%<span className="od-menu-mobile-label"> of menu item sales</span><progress aria-label={`${row.name} share of menu item sales`} max={100} value={Math.max(0, Math.min(100, row.salesSharePercent))} /></>}</td>
      </tr>)}
    </tbody></table> : <p className="od-reports-empty">No menu-item sales were recorded during this period.</p>}
    <details className="od-menu-zero"><summary>{report.period.key === 'today' ? 'No Sales Today' : 'No Sales This Period'} ({report.noSalesItems.length})</summary><p>Items available on your menu now with no recorded sales in this period.</p>
      {report.noSalesItems.length ? <ul>{report.noSalesItems.map(row => <li key={row.menuItemKey}><span>{row.name}<small>{row.category}</small></span><strong>0 sold</strong></li>)}</ul> : <p>No currently available items have zero recorded sales.</p>}
    </details>
    {report.unmatchedItemLineCount > 0 && <p className="od-reports-subtle-note">Some older sales could not be matched to the current menu. Their recorded sales value remains included.</p>}
    {report.legacyUnattributedItemCount > 0 && <p className="od-reports-subtle-note">Some older items have no linked payment and cannot be assigned to a reporting period.</p>}
    <p className="od-reports-help od-menu-definition">Names and categories reflect your current menu. Sales value does not allocate discounts, tax, service charges or refunds; it is not Money Collected.</p>
  </>;
}

export function OwnerMenuSalesReport({ restaurantId, period, start, end, preview }: { restaurantId: string; period: OwnerReportsPeriodKey; start: string | null; end: string | null; preview: ReactNode }) {
  const [report, setReport] = useState<MenuSalesReport | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0); const busy = useRef(false);
  useEffect(() => () => { generation.current++; }, []);
  const load = async () => {
    if (busy.current) return;
    busy.current = true; const request = ++generation.current;
    setOpen(true); setLoading(true); setError(null);
    try { const next = await loadOwnerMenuSalesReport(restaurantId, period, start, end); if (request === generation.current) setReport(next); }
    catch { if (request === generation.current) setError('Could not load menu sales. Try again.'); }
    finally { if (request === generation.current) { busy.current = false; setLoading(false); } }
  };
  return <section className="od-reports-panel od-menu-sales">
    <header className="od-reports-panel-header"><div><span>Menu performance</span><h2>{menuSalesTitle(period)}</h2></div><button type="button" className="od-menu-open" aria-expanded={open} disabled={loading} onClick={() => { if (open) setOpen(false); else if (report) setOpen(true); else void load(); }}>{loading ? 'Loading menu sales…' : open ? 'Show summary' : 'View full menu report'}</button></header>
    {!open && <><p className="od-reports-help">Highest-selling items by quantity. Open the full report for every recorded item.</p>{preview}</>}
    {open && loading && <p role="status">Loading menu sales…</p>}
    {open && error && <div role="alert"><p>{error}</p><button type="button" className="od-menu-open" onClick={() => void load()}>Try again</button></div>}
    {open && report && <><p className="od-reports-context">{new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: report.period.timezone }).format(new Date(report.period.currentStart))} – {new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: report.period.timezone }).format(new Date(Date.parse(report.period.currentEnd) - 1))}{report.period.completeness === 'in_progress' ? ' · In progress' : ''}</p><MenuSalesRows report={report} /></>}
  </section>;
}
