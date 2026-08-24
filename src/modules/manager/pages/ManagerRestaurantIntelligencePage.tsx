import { useCallback, useEffect, useMemo, useState } from "react";
import { useTenantRealtime } from "../../../core/realtime/useTenantRealtime";
import type { CurrencyConfig } from "../../../core/format/currency";
import {
  buildBusinessIntelligence,
  loadRestaurantIntelligence,
  type BusinessIntelligenceSignal,
  type RestaurantIntelligenceSnapshot,
} from "../services/managerRestaurantIntelligenceService";
import "../styles/managerRestaurantIntelligence.css";
import { managerFacingMessage } from "../managerPresentation";

type Props = {
  restaurantId: string;
  restaurantName: string;
  managerName: string;
  currency?: CurrencyConfig;
};

type Horizon = "today" | "tomorrow" | "next-service";

const AREA_LABELS: Record<BusinessIntelligenceSignal["businessArea"], string> = {
  demand: "Demand",
  menu: "Menu",
  staff: "Staffing",
  kitchen: "Kitchen",
  inventory: "Inventory",
  guest: "Guest service",
  finance: "Finance",
  operations: "Operations",
};

function updatedLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function focusHorizon(horizon: Horizon) {
  const target = horizon === "tomorrow" ? "bi-tomorrow" : horizon === "today" ? "bi-risks" : "bi-next-service";
  document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function SignalCard({ signal }: { signal: BusinessIntelligenceSignal }) {
  return (
    <article className={`mri-signal ${signal.severity}`}>
      <header><span>{AREA_LABELS[signal.businessArea]}</span><b>{signal.severity}</b></header>
      <h3>{signal.title}</h3>
      <p>{signal.summary}</p>
      <dl>
        <div><dt>Evidence</dt><dd>{signal.evidence}</dd></div>
        <div><dt>Prepare</dt><dd>{signal.recommendation}</dd></div>
      </dl>
    </article>
  );
}

export function ManagerRestaurantIntelligencePage({ restaurantId }: Props) {
  const [data, setData] = useState<RestaurantIntelligenceSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [horizon, setHorizon] = useState<Horizon>("next-service");

  const load = useCallback(async (force = true) => {
    try {
      setLoading(true);
      setData(await loadRestaurantIntelligence(restaurantId, force));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Business Intelligence is unavailable.");
    } finally {
      setLoading(false);
    }
  }, [restaurantId]);

  useEffect(() => { void load(false); }, [load]);

  useTenantRealtime({
    channelName: "restaurant-intelligence",
    restaurantId,
    tables: ["orders", "order_items", "restaurant_staff", "restaurant_table_waiter_assignments", "manager_customer_complaints", "kitchen_inventory_requests", "inventory_items"],
    refresh: load,
    skipInitialConnectRefresh: true,
  });

  const intelligence = useMemo(() => data ? buildBusinessIntelligence(data) : null, [data]);

  function selectHorizon(next: Horizon) {
    setHorizon(next);
    focusHorizon(next);
  }

  return (
    <main className="mri-page" aria-busy={loading}>
      <section className="mri-toolbar" aria-label="Business Intelligence controls">
        <div className="mri-toolbar-controls">
          <div className="mri-horizons" aria-label="Intelligence time horizon">
            <button type="button" className={horizon === "today" ? "active" : ""} onClick={() => selectHorizon("today")}>Today</button>
            <button type="button" className={horizon === "tomorrow" ? "active" : ""} onClick={() => selectHorizon("tomorrow")}>Tomorrow</button>
            <button type="button" className={horizon === "next-service" ? "active" : ""} onClick={() => selectHorizon("next-service")}>Next Service</button>
          </div>
          <div className="mri-updated"><span>{data ? `Updated ${updatedLabel(data.generatedAt)}` : "Updating"}</span><button type="button" disabled={loading} onClick={() => void load()}>{loading ? "Refreshing…" : "Refresh"}</button></div>
        </div>
      </section>

      {error && <div className="mri-error" role="alert">{managerFacingMessage(error, "Unable to load business insights. Try again.")}</div>}
      {loading && !data && <div className="mri-loading" role="status">Loading business insights…</div>}

      {intelligence && data && <>
        <section className="mri-next" id="bi-next-service" aria-labelledby="bi-next-title">
          <header><div><span>Next Service</span><h2 id="bi-next-title">{intelligence.nextService.name}</h2>{intelligence.nextService.window && <p>{intelligence.nextService.window}</p>}</div><b className={intelligence.nextService.supported ? "supported" : "limited"}>{intelligence.nextService.supported ? "History available" : "Building history"}</b></header>
          {intelligence.nextService.supported ? <>
            <div className="mri-readiness">
              <div><span>Demand</span><strong className={intelligence.nextService.demand === "Elevated" ? "attention" : "healthy"}>{intelligence.nextService.demand}</strong></div>
              <div><span>Staffing</span><strong className={intelligence.nextService.staffing === "Attention" ? "attention" : "healthy"}>{intelligence.nextService.staffing}</strong></div>
              <div><span>Kitchen</span><strong className={intelligence.nextService.kitchen === "Attention" ? "attention" : "healthy"}>{intelligence.nextService.kitchen}</strong></div>
              <div><span>Inventory</span><strong className={intelligence.nextService.inventory.includes("risk") ? "attention" : "healthy"}>{intelligence.nextService.inventory}</strong></div>
            </div>
            <p className="mri-evidence">{intelligence.nextService.evidence}</p>
            <section className="mri-preparation"><h3>Recommended Preparation</h3><ul>{intelligence.nextService.recommendations.map((item) => <li key={item}>{item}</li>)}</ul></section>
          </> : <div className="mri-insufficient"><strong>Not enough operating history yet to predict the next service.</strong><span>{intelligence.nextService.evidence}</span></div>}
        </section>

        <div className="mri-decision-grid">
          <section className="mri-section" id="bi-risks" aria-labelledby="bi-risks-title">
            <header><div><span>Prepare before impact</span><h2 id="bi-risks-title">Operational Risks</h2></div>{intelligence.risks.length > 0 && <b>{intelligence.risks.length}</b>}</header>
            <div className="mri-signal-list">{intelligence.risks.length ? intelligence.risks.map((signal) => <SignalCard key={signal.id} signal={signal} />) : <div className="mri-healthy"><i /> <span><strong>No significant operational risks detected.</strong><small>Current thresholds are within their normal range.</small></span></div>}</div>
          </section>

          <section className="mri-section" aria-labelledby="bi-opportunities-title">
            <header><div><span>Positive demand signals</span><h2 id="bi-opportunities-title">Business Opportunities</h2></div></header>
            <div className="mri-signal-list">{intelligence.opportunities.length ? intelligence.opportunities.map((signal) => <SignalCard key={signal.id} signal={signal} />) : <div className="mri-neutral"><strong>No strong opportunity signals detected yet.</strong><span>More comparable demand history is needed before highlighting an opportunity.</span></div>}</div>
          </section>
        </div>

        <section className="mri-section mri-tomorrow" id="bi-tomorrow" aria-labelledby="bi-tomorrow-title">
          <header><div><span>Next operating day</span><h2 id="bi-tomorrow-title">Tomorrow&apos;s Preparation</h2></div><b className="limited">Forecast limited</b></header>
          <p className="mri-tomorrow-note">{intelligence.tomorrow.message}</p>
          <div className="mri-tomorrow-grid">
            <article><span>Demand</span><p>{intelligence.tomorrow.demand}</p></article>
            <article><span>Inventory</span><p>{intelligence.tomorrow.inventory}</p></article>
            <article><span>Staffing</span><p>{intelligence.tomorrow.staffing}</p></article>
            <article><span>Kitchen</span><p>{intelligence.tomorrow.kitchen}</p></article>
          </div>
        </section>
      </>}
    </main>
  );
}
