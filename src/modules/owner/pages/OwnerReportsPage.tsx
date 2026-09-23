import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Info, MessageSquare, RefreshCw, Star, X } from "lucide-react";
import {
  loadOwnerReportFeedbackPage,
  loadOwnerReportStaffOperationsPage,
  loadOwnerReportsReadModel,
  type OwnerReportsFeedbackPage,
  type OwnerReportsPeriodKey,
  type OwnerReportsReadModel,
  type OwnerReportsStaffPage,
} from "../services/ownerReportsReadModel";
import "../styles/ownerReports.css";

type Props = { restaurantId: string };

const periodOptions: Array<{ value: OwnerReportsPeriodKey; label: string }> = [
  { value: "today", label: "Today" }, { value: "yesterday", label: "Yesterday" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }, { value: "custom", label: "Custom" },
];

function money(value: number | null, currency: string) {
  if (value === null || !Number.isFinite(value)) return "Unavailable";
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value)} ${currency}`;
}
function number(value: number) { return new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(value); }
function minutes(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "Not enough timing data";
  const total = Math.max(0, Math.round(value)); const hours = Math.floor(total / 60); const remainder = total % 60;
  return hours ? `${hours} hr${remainder ? ` ${remainder} min` : ""}` : `${remainder} min`;
}
function sourceLabel(source: string) { return ({ customer_qr: "Customer QR", waiter: "Waiter", cashier_pos: "Cashier / POS", authenticated_customer_legacy: "Other / older orders", unknown_legacy: "Unknown" } as Record<string, string>)[source] ?? "Unknown"; }
function qualityNote(model: OwnerReportsReadModel) {
  const notices = [model.summary.quality, model.menu.quality, model.operations.kitchen.quality, model.payments.quality].flatMap((quality) => quality.notices);
  return [...new Set(notices)].find(Boolean) ?? null;
}
function humanPeriod(model: OwnerReportsReadModel) {
  const fmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: model.period.timezone });
  const start = fmt.format(new Date(model.period.currentStart)); const end = fmt.format(new Date(new Date(model.period.currentEnd).getTime() - 1));
  return start === end ? start : `${start} – ${end}`;
}
function trendLabel(bucket: OwnerReportsReadModel["salesAndOrders"]["buckets"][number], granularity: OwnerReportsReadModel["salesAndOrders"]["granularity"], timezone: string) {
  const date = new Date(bucket.bucketStart);
  if (granularity === "hour") return new Intl.DateTimeFormat("en", { hour: "numeric", timeZone: timezone }).format(date);
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: timezone }).format(date);
}
function attentionItems(model: OwnerReportsReadModel) {
  const items: string[] = [];
  if (model.summary.refundCount > 0) items.push(`${number(model.summary.refundCount)} refund${model.summary.refundCount === 1 ? " was" : "s were"} recorded during this period.`);
  if (model.payments.quality.unknownCount > 0) items.push(`${number(model.payments.quality.unknownCount)} payment record${model.payments.quality.unknownCount === 1 ? " needs" : "s need"} classification.`);
  if (model.operations.kitchen.untimedItems > 0) items.push(`${number(model.operations.kitchen.untimedItems)} completed kitchen item${model.operations.kitchen.untimedItems === 1 ? " doesn't" : "s don't"} have full preparation-time records.`);
  if (model.menu.legacyUnattributedItemCount > 0) items.push("Some older item activity could not be included in menu sales.");
  return items.slice(0, 4);
}
function comparisonSentence(model: OwnerReportsReadModel): string | null {
  if (!model.period.durationSecondsEqual) return null;
  const change = model.summary.comparison.collectedSalesPercentChange;
  const current = model.summary.collectedSales;
  const previous = model.summary.comparison.collectedSales;
  const prefix = model.period.completeness === "in_progress" ? "So far, " : "";
  if (change === null || previous === 0) return `${prefix}previous comparable period: ${money(previous, model.currency)}.`;
  const difference = current - previous;
  if (Math.abs(change) < 0.5) return `${prefix}money collected was about the same as the previous comparable period.`;
  return `${prefix}money collected was ${Math.abs(change).toFixed(1)}% ${change > 0 ? "higher" : "lower"} than the previous comparable period (${difference > 0 ? "+" : ""}${money(difference, model.currency)}).`;
}

export function OwnerReportsPage({ restaurantId }: Props) {
  const [period, setPeriod] = useState<OwnerReportsPeriodKey>("today");
  const today = new Date().toISOString().slice(0, 10);
  const [customStart, setCustomStart] = useState(today);
  const [customEnd, setCustomEnd] = useState(today);
  const [appliedCustom, setAppliedCustom] = useState({ start: today, end: today });
  const [model, setModel] = useState<OwnerReportsReadModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [detail, setDetail] = useState<"feedback" | "staff" | null>(null);
  const [feedback, setFeedback] = useState<OwnerReportsFeedbackPage | null>(null);
  const [staff, setStaff] = useState<OwnerReportsStaffPage | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestId = useRef(0);

  const query = useMemo(() => ({ period, start: period === "custom" ? appliedCustom.start : null, end: period === "custom" ? appliedCustom.end : null }), [appliedCustom, period]);
  const loadMain = useCallback(async (kind: "entry" | "refresh" = "entry") => {
    const current = ++requestId.current;
    if (kind === "refresh") setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const next = await loadOwnerReportsReadModel(restaurantId, query.period, query.start, query.end);
      if (current !== requestId.current) return;
      setModel(next); setNotice(kind === "refresh" ? "Report refreshed." : null);
    } catch (caught) {
      if (current !== requestId.current) return;
      setError(caught instanceof Error ? caught.message : "Couldn’t load this report. Try again.");
    } finally {
      if (current === requestId.current) { setLoading(false); setRefreshing(false); }
    }
  }, [query, restaurantId]);

  useEffect(() => { setDetail(null); setFeedback(null); setStaff(null); void loadMain(); }, [loadMain]);
  useEffect(() => { if (!detail) return; const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setDetail(null); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [detail]);

  const openDetail = async (kind: "feedback" | "staff", more = false) => {
    if (!model || detailLoading || loadingMore) return;
    setDetail(kind); setDetailError(null); more ? setLoadingMore(true) : setDetailLoading(true);
    try {
      if (kind === "feedback") {
        const page = await loadOwnerReportFeedbackPage(restaurantId, query.period, query.start, query.end, more ? feedback?.nextCursor ?? null : null);
        setFeedback((previous) => more && previous ? { ...page, items: [...previous.items, ...page.items] } : page);
      } else {
        const page = await loadOwnerReportStaffOperationsPage(restaurantId, query.period, query.start, query.end, more ? staff?.nextCursor ?? null : null);
        setStaff((previous) => more && previous ? { ...page, items: [...previous.items, ...page.items] } : page);
      }
    } catch (caught) { setDetailError(caught instanceof Error ? caught.message : "Couldn’t load this detail. Try again."); }
    finally { setDetailLoading(false); setLoadingMore(false); }
  };

  const applyCustom = () => { setNotice(null); setAppliedCustom({ start: customStart, end: customEnd }); };
  const selected = (next: OwnerReportsPeriodKey) => { setNotice(null); setPeriod(next); };

  return <div className="od-page od-reports-r4">
    <div className="od-reports-controls" aria-label="Report period controls">
      <div className="od-reports-periods" role="group" aria-label="Choose report period">
        {periodOptions.map((option) => <button type="button" key={option.value} className={period === option.value ? "active" : ""} aria-pressed={period === option.value} onClick={() => selected(option.value)}>{option.label}</button>)}
      </div>
      <button type="button" className="od-reports-refresh" onClick={() => void loadMain("refresh")} disabled={loading || refreshing} aria-label="Refresh report"><RefreshCw aria-hidden="true" className={refreshing ? "spin" : ""} /> <span>{refreshing ? "Refreshing" : "Refresh"}</span></button>
      {period === "custom" && <div className="od-reports-custom">
        <label>From<input type="date" value={customStart} max={customEnd || today} onChange={(event) => setCustomStart(event.target.value)} /></label>
        <label>To<input type="date" value={customEnd} min={customStart} max={today} onChange={(event) => setCustomEnd(event.target.value)} /></label>
        <button type="button" onClick={applyCustom} disabled={!customStart || !customEnd}>Apply</button>
      </div>}
    </div>
    {notice && <div className="od-reports-toast" role="status">{notice}</div>}
    {error && !model ? <section className="od-reports-state error"><strong>Couldn’t load this report</strong><span>{error}</span><button type="button" onClick={() => void loadMain()}>Try again</button></section> : null}
    {loading && !model ? <ReportsSkeleton /> : null}
    {model ? <ReportsContent model={model} onOpenFeedback={() => void openDetail("feedback")} onOpenStaff={() => void openDetail("staff")} onRefresh={() => void loadMain("refresh")} /> : null}
    {loading && model ? <span className="od-reports-refreshing" role="status">Updating report…</span> : null}
    {detail && <DetailSheet kind={detail} model={model} feedback={feedback} staff={staff} loading={detailLoading} loadingMore={loadingMore} error={detailError} onClose={() => setDetail(null)} onRetry={() => void openDetail(detail)} onMore={() => void openDetail(detail, true)} />}
  </div>;
}

function ReportsContent({ model, onOpenFeedback, onOpenStaff }: { model: OwnerReportsReadModel; onOpenFeedback: () => void; onOpenStaff: () => void; onRefresh: () => void }) {
  const note = qualityNote(model); const trendEmpty = model.salesAndOrders.quality.state === "no_activity"; const attention = attentionItems(model); const comparison = comparisonSentence(model);
  return <>
    <div className="od-reports-context"><span>{humanPeriod(model)}</span>{model.period.completeness === "in_progress" ? <em>In progress</em> : null}</div>
    {note ? <div className="od-reports-quality"><Info aria-hidden="true" /><span>{friendlyNotice(note)}</span></div> : null}
    <section className="od-reports-summary" aria-labelledby="owner-reports-summary-title">
      <div className="od-reports-summary-primary"><span id="owner-reports-summary-title">Money Collected</span><strong>{money(model.summary.collectedSales, model.currency)}</strong><Comparison value={model.summary.comparison.collectedSalesPercentChange} comparable={model.period.durationSecondsEqual} /></div>
      <Metric label="Payments collected" value={number(model.summary.collectedInvoices)} />
      <Metric label="Orders Started" value={number(model.summary.ordersStarted)} />
      <Metric label="Average payment collected" value={money(model.summary.averageCollectedInvoice, model.currency)} />
      <Metric label="Refunds" value={model.summary.refundCount ? `${money(model.summary.refundAmount, model.currency)} · ${number(model.summary.refundCount)}` : money(0, model.currency)} />
    </section>
    <section className="od-reports-panel od-reports-attention"><PanelHeader eyebrow="Needs attention" title="Facts to review" />
      {attention.length ? <ul>{attention.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No report issues need review for this period.</p>}
    </section>
    <section className="od-reports-panel od-reports-trend"><PanelHeader eyebrow="Sales history" title="Money collected over time" meta="Based on collected payments" />
      <div className="od-reports-sales-copy"><strong>{`You collected ${money(model.summary.collectedSales, model.currency)} in this period.`}</strong>{comparison ? <span>{comparison}</span> : null}</div>
      {trendEmpty ? <Empty text="No sales or orders were recorded in this period." /> : <TrendChart model={model} />}
    </section>
    <div className="od-reports-two-up">
      <section className="od-reports-panel"><PanelHeader eyebrow="Menu performance" title="Top selling" />
        {model.menu.topSelling.length ? <RankedItems rows={model.menu.topSelling} currency={model.currency} /> : <Empty text="No menu activity was recorded in this period." />}
        {model.menu.categories.length ? <div className="od-reports-category-list">{model.menu.categories.slice(0, 4).map((row) => <div key={row.categoryKey}><span>{row.name}</span><strong>{number(row.quantity)} sold</strong></div>)}</div> : null}
      </section>
      <section className="od-reports-panel"><PanelHeader eyebrow="Menu performance" title="Needs attention" />
        <p className="od-reports-help">Based on menu items available now. Past menu availability is not tracked.</p>
        {model.menu.currentMenuItemsWithLowestRecordedSales.length ? <div className="od-reports-low-list">{model.menu.currentMenuItemsWithLowestRecordedSales.slice(0, 5).map((row) => <div key={row.menuItemKey ?? row.name}><span><strong>{row.name}</strong><small>{row.category}</small></span><b>{number(row.quantity)} sold</b></div>)}</div> : <Empty text="No available menu items to compare." />}
        {model.menu.legacyUnattributedItemCount > 0 ? <p className="od-reports-subtle-note">Some older item activity could not be included in menu sales.</p> : null}
      </section>
    </div>
    <section className="od-reports-panel"><PanelHeader eyebrow="Orders" title="Orders and table activity" />
      <div className="od-reports-operations-grid">
        <OperationList title="Where orders came from" rows={model.operations.orderSources.map((row) => ({ label: sourceLabel(row.source), value: `${number(row.ordersStarted)} orders` }))} empty="No orders were recorded in this period." />
        <OperationList title="Busiest tables" rows={model.operations.tableActivity.busiestByOrdersStarted.slice(0, 5).map((row) => ({ label: tableLabel(row.label), value: `${number(row.ordersStarted ?? 0)} orders` }))} empty="No table activity was recorded." />
        <OperationList title="Highest sales by table" rows={model.operations.tableActivity.topByCollectedSales.slice(0, 5).map((row) => ({ label: tableLabel(row.label), value: `${money(row.collectedSales ?? 0, model.currency)} collected` }))} empty="No table collections were recorded." />
      </div>
    </section>
    <section className="od-reports-panel od-reports-detail-entry od-reports-section-gap"><PanelHeader eyebrow="Staff activity" title="Activity handled by staff" /><p>Review factual business activity attributed to staff during this period.</p><button type="button" onClick={onOpenStaff}>View staff activity <ChevronRight aria-hidden="true" /></button></section>
    <section className="od-reports-panel"><PanelHeader eyebrow="Kitchen performance" title="Preparation activity" />
      <div className="od-reports-kitchen-facts"><Metric label="Completed items" value={number(model.operations.kitchen.completedItems)} /><Metric label="Average preparation time" value={minutes(model.operations.kitchen.averagePreparationMinutes)} /><Metric label="Typical preparation time" value={minutes(model.operations.kitchen.medianPreparationMinutes)} /><Metric label="Timing records" value={model.operations.kitchen.timingCoveragePercent === null ? "Not enough timing data" : `Recorded for ${model.operations.kitchen.timingCoveragePercent.toFixed(0)}%`} /></div>
      {model.operations.kitchen.untimedItems > 0 ? <p className="od-reports-subtle-note">Timing was not recorded for {number(model.operations.kitchen.untimedItems)} completed item{model.operations.kitchen.untimedItems === 1 ? "" : "s"}.</p> : null}
    </section>
    <section className="od-reports-panel od-reports-section-gap"><PanelHeader eyebrow="Payments & cash" title="How customers paid" />
      {model.payments.methods.length ? <div className="od-reports-payments">{model.payments.methods.map((method, index) => <div key={method.methodIdentity ?? `${method.displayLabel}-${index}`}><div><strong>{method.displayLabel}</strong><span>{method.classification === "legacy_unrecognized" ? "Older payment method" : method.classification === "unknown_unclassified" ? "Unclassified" : null}{method.currentlyEnabled === false ? " · Currently inactive" : null}</span></div><b>{money(method.collectedAmount, model.currency)}</b><small>{number(method.collectedInvoices)} payment{method.collectedInvoices === 1 ? "" : "s"} · {method.sharePercent === null ? "Share unavailable" : `${method.sharePercent.toFixed(0)}%`}</small><i aria-hidden="true"><em style={{ width: `${Math.max(0, Math.min(100, method.sharePercent ?? 0))}%` }} /></i></div>)}</div> : <Empty text="No payments were collected in this period." />}
    </section>
    <div className="od-reports-feedback-wrap">
      <section className="od-reports-panel od-reports-feedback"><PanelHeader eyebrow="Customer feedback" title={model.feedback.reviewCount ? `${model.feedback.averageOrderExperienceRating?.toFixed(1) ?? "—"} / 5 order experience` : "No feedback yet"} /><p>{model.feedback.reviewCount ? `${number(model.feedback.reviewCount)} response${model.feedback.reviewCount === 1 ? "" : "s"} in this period.` : "Customer feedback will appear here when it is submitted."}</p><button type="button" onClick={onOpenFeedback} disabled={!model.feedback.detailAvailable}>View feedback <MessageSquare aria-hidden="true" /></button></section>
    </div>
  </>;
}

function DetailSheet({ kind, model, feedback, staff, loading, loadingMore, error, onClose, onRetry, onMore }: { kind: "feedback" | "staff"; model: OwnerReportsReadModel | null; feedback: OwnerReportsFeedbackPage | null; staff: OwnerReportsStaffPage | null; loading: boolean; loadingMore: boolean; error: string | null; onClose: () => void; onRetry: () => void; onMore: () => void }) {
  const page = kind === "feedback" ? feedback : staff; const cursor = kind === "feedback" ? feedback?.nextCursor : staff?.nextCursor;
  return <div className="od-reports-sheet-backdrop" role="presentation" onMouseDown={onClose}><aside className="od-reports-sheet" role="dialog" aria-modal="true" aria-label={kind === "feedback" ? "Customer feedback" : "Staff activity"} onMouseDown={(event) => event.stopPropagation()}>
    <header><div><span>{kind === "feedback" ? "Customer feedback" : "Staff activity"}</span><h2>{kind === "feedback" ? "Responses in this period" : "Activity handled by staff"}</h2></div><button type="button" onClick={onClose} aria-label="Close details"><X aria-hidden="true" /></button></header>
    {loading && !page ? <div className="od-reports-sheet-state">Loading…</div> : null}
    {error ? <div className="od-reports-sheet-state error"><p>{error}</p><button type="button" onClick={onRetry}>Try again</button></div> : null}
    {kind === "feedback" && feedback ? <div className="od-reports-feedback-items">{feedback.items.length ? feedback.items.map((item, index) => <article key={`${item.submittedAt}-${index}`}><strong>{item.rating} / 5 <Star aria-hidden="true" /></strong><span>{item.reactions.join(" · ")}</span>{item.comment ? <p>{item.comment}</p> : <p className="quiet">No written comment.</p>}{item.hasPhoto ? <small>Photo attached</small> : null}</article>) : <Empty text="No customer feedback was submitted in this period." />}</div> : null}
    {kind === "staff" && staff ? <div className="od-reports-staff-items">{staff.items.length ? staff.items.map((item, index) => <article key={`${item.role}-${item.displayName}-${index}`}><header><div><span>{item.role}</span><strong>{item.displayName}</strong></div>{item.membershipState === "inactive" ? <small>Inactive now</small> : null}</header>{item.role === "waiter" ? <Fact label="Orders handled" value={number(item.operations.ordersTaken)} /> : null}{item.role === "kitchen" ? <Fact label="Items completed" value={number(item.operations.itemsCompleted)} /> : null}{item.role === "cashier" ? <div className="od-reports-staff-facts"><Fact label="Payments handled" value={number(item.operations.settlementsHandled)} /><Fact label="Money handled" value={money(item.operations.collectedAmountHandled, model?.currency ?? "ETB")} /><Fact label="Cashier shifts" value={`${number(item.operations.financialShiftsOpened)} opened · ${number(item.operations.financialShiftsClosed)} closed`} /><Fact label="Reconciliations" value={number(item.operations.reconciliationsCompleted)} /><Fact label="Cash difference" value={money(item.operations.recordedVariance, model?.currency ?? "ETB")} /><Fact label="Cash handovers" value={`${number(item.operations.handoversInitiated)} initiated · ${number(item.operations.handoversConfirmed)} confirmed`} /></div> : null}</article>) : <Empty text="No staff activity was recorded in this period." />}</div> : null}
    {cursor ? <button type="button" className="od-reports-load-more" onClick={onMore} disabled={loadingMore}>{loadingMore ? "Loading…" : "Load more"}</button> : null}
  </aside></div>;
}

function TrendChart({ model }: { model: OwnerReportsReadModel }) {
  const buckets = model.salesAndOrders.buckets; const width = 760; const height = 220; const pad = 22; const maxSales = Math.max(...buckets.map((bucket) => bucket.collectedSales), 1);
  const points = buckets.map((bucket, index) => ({ bucket, x: buckets.length === 1 ? width / 2 : pad + index * ((width - pad * 2) / (buckets.length - 1)), salesY: height - pad - (bucket.collectedSales / maxSales) * (height - pad * 2) }));
  const labelIndexes = [...new Set([0, Math.floor((buckets.length - 1) / 2), buckets.length - 1])];
  return <div className="od-reports-chart"><div className="od-reports-chart-legend"><span><i className="sales" />Money collected</span></div><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`Money collected across ${buckets.length} report periods`}><line x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} /><polyline points={points.map((point) => `${point.x},${point.salesY}`).join(" ")} className="sales" />{points.map((point) => <circle key={point.bucket.bucketStart} cx={point.x} cy={point.salesY} r="2.8"><title>{`${trendLabel(point.bucket, model.salesAndOrders.granularity, model.period.timezone)}: ${money(point.bucket.collectedSales, model.currency)}`}</title></circle>)}</svg><div className="od-reports-chart-labels">{labelIndexes.map((index) => <span key={buckets[index].bucketStart}>{trendLabel(buckets[index], model.salesAndOrders.granularity, model.period.timezone)}</span>)}</div></div>;
}
function PanelHeader({ eyebrow, title, meta }: { eyebrow: string; title: string; meta?: string }) { return <header className="od-reports-panel-header"><div><span>{eyebrow}</span><h2>{title}</h2></div>{meta ? <small>{meta}</small> : null}</header>; }
function Metric({ label, value }: { label: string; value: string }) { return <article className="od-reports-metric"><span>{label}</span><strong>{value}</strong></article>; }
function Comparison({ value, comparable }: { value: number | null; comparable: boolean }) { return comparable ? <small className="od-reports-comparison">{value === null ? "Comparison unavailable" : `${value > 0 ? "+" : ""}${value.toFixed(1)}% vs previous comparable period`}</small> : null; }
function Empty({ text }: { text: string }) { return <div className="od-reports-empty">{text}</div>; }
function RankedItems({ rows, currency }: { rows: OwnerReportsReadModel["menu"]["topSelling"]; currency: string }) { const max = Math.max(...rows.map((row) => row.quantity), 1); return <div className="od-reports-ranked">{rows.slice(0, 5).map((row) => <div key={row.menuItemKey ?? row.name}><span><strong>{row.name}</strong><small>{row.category}{row.archived ? " · Archived" : ""}</small></span><i aria-hidden="true"><em style={{ width: `${row.quantity / max * 100}%` }} /></i><b>{number(row.quantity)}</b><small>{money(row.itemLineSalesValue, currency)}</small></div>)}</div>; }
function OperationList({ title, rows, empty }: { title: string; rows: Array<{ label: string; value: string }>; empty: string }) { return <article className="od-reports-operation"><h3>{title}</h3>{rows.length ? rows.map((row) => <div key={`${row.label}-${row.value}`}><span>{row.label}</span><strong>{row.value}</strong></div>) : <p>{empty}</p>}</article>; }
function Fact({ label, value }: { label: string; value: string }) { return <div className="od-reports-fact"><span>{label}</span><strong>{value}</strong></div>; }
function ReportsSkeleton() { return <div className="od-reports-skeleton" role="status" aria-label="Loading reports"><div className="summary" /><div className="wide" /><div /><div /></div>; }
function tableLabel(label: string) { return /^\d+$/.test(label) ? `Table ${label}` : label; }
function friendlyNotice(value: string) {
  const replacements: Record<string, string> = {
    "Legacy refunds without refunded_at cannot be assigned to a report period.": "Some older refund history is incomplete.",
    "Names and categories use the current catalog because immutable historical name/category snapshots do not exist.": "Menu names and categories reflect your current menu.",
    "Current menu items with lowest recorded sales use the current catalog; historical availability is not tracked.": "Low-selling menu items are based on your current menu.",
    "Item-line sales value is not equal to accounting collected sales.": "Menu sales totals show item sales before payment adjustments.",
    "Station names use the current kitchen-station catalog because immutable historical station snapshots do not exist.": "Kitchen station names reflect your current setup.",
  };
  return replacements[value] ?? value;
}
