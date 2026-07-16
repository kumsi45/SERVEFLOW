import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../core/database";
import {
  formatCurrency,
  type CurrencyConfig,
} from "../../../core/format/currency";
import {
  loadRestaurantIntelligence,
  type RestaurantIntelligenceSnapshot,
} from "../services/managerRestaurantIntelligenceService";
import "../styles/managerRestaurantIntelligence.css";
export function ManagerRestaurantIntelligencePage({
  restaurantId,
  currency,
}: {
  restaurantId: string;
  restaurantName: string;
  managerName: string;
  currency?: CurrencyConfig;
}) {
  const [data, setData] = useState<RestaurantIntelligenceSnapshot | null>(null),
    [error, setError] = useState<string | null>(null),
    [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      setLoading(true);
      setData(await loadRestaurantIntelligence(restaurantId));
      setError(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Restaurant Intelligence unavailable.",
      );
    } finally {
      setLoading(false);
    }
  }, [restaurantId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const channel = supabase.channel(`restaurant-intelligence:${restaurantId}`);
    for (const table of [
      "orders",
      "order_items",
      "restaurant_staff",
      "restaurant_table_waiter_assignments",
      "manager_customer_complaints",
      "kitchen_inventory_requests",
      "inventory_items",
    ])
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        () => void load(),
      );
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load, restaurantId]);
  return (
    <main className="mri-page" aria-busy={loading}>
      {error && <div className="mri-error" role="alert">{error}</div>}
      <section className="mri-brief">
        <div>
          <span>Decision Workspace</span>
          <h1>Restaurant Intelligence</h1>
          <p>
            Forward-looking recommendations from live operations, recent
            history, and inventory consumption.
          </p>
        </div>
        <button type="button" disabled={loading} onClick={() => void load()}>{loading ? "Refreshing…" : "Refresh intelligence"}</button>
      </section>
      {loading && !data && <div className="mri-loading" role="status">Loading live restaurant intelligence…</div>}
      {data && <>
      <section className="mri-kpis">
        <article>
          <span>Current Revenue</span>
          <strong>
            {formatCurrency(data?.today.summary.revenue ?? 0, currency)}
          </strong>
          <small>Today</small>
        </article>
        <article>
          <span>Operational Health</span>
          <strong>{data?.operations.health.overall ?? 0}%</strong>
          <small>{data?.operations.health.trend ?? "Loading"}</small>
        </article>
        <article>
          <span>Future Actions</span>
          <strong>
            {data?.modules.reduce(
              (sum, module) => sum + module.actions.length,
              0,
            ) ?? 0}
          </strong>
          <small>Evidence-based</small>
        </article>
        <article>
          <span>Active Risks</span>
          <strong>{data?.operations.alerts.length ?? 0}</strong>
          <small>Live signals</small>
        </article>
      </section>
      <section className="mri-grid">
        {data?.modules.map((module) => (
          <article
            className={`mri-module ${module.supported ? "" : "unsupported"}`}
            key={module.key}
          >
            <header>
              <div>
                <span>{module.title}</span>
                <h2>{module.question}</h2>
              </div>
              {module.confidence != null && (
                <b>{module.confidence}% confidence</b>
              )}
            </header>
            <strong className="mri-status">{module.status}</strong>
            <p>{module.summary}</p>
            <section>
              <span>Recommended next actions</span>
              {module.actions.length ? (
                <ul>
                  {module.actions.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
              ) : (
                <small>
                  {module.supported
                    ? "No intervention recommended from current evidence."
                    : "A supported data history is required before recommending action."}
                </small>
              )}
            </section>
          </article>
        ))}
      </section>
      <a className="mri-copilot" href="/manager/ai">
        <div>
          <span>AI Operations Assistant</span>
          <strong>Ask follow-up questions about live restaurant signals</strong>
        </div>
        <b>Open Copilot →</b>
      </a>
      </>}
    </main>
  );
}
