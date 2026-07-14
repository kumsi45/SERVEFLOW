import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../core/database";
import {
  loadManagerAiOperations,
  logManagerAiDecision,
  type AiDecision,
  type ManagerAiOperationsSnapshot,
  type ManagerAiRecommendation,
} from "../services/managerAiOperationsService";
import "../styles/managerAiOperations.css";

type Props = {
  restaurantId: string;
  restaurantName: string;
  managerName: string;
};

function scoreClass(score: number) {
  if (score >= 85) return "green";
  if (score >= 70) return "yellow";
  return "red";
}

function priorityLabel(priority: string) {
  return priority.replace("_", " ");
}

export function ManagerAiOperationsPage({ restaurantId, restaurantName, managerName }: Props) {
  const [snapshot, setSnapshot] = useState<ManagerAiOperationsSnapshot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await loadManagerAiOperations(restaurantId);
      setSnapshot(next);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "AI Operations Assistant unavailable.");
    }
  }, [restaurantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const channel = supabase
      .channel(`manager-ai-operations:${restaurantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items", filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "order_invoices", filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "kitchen_stations", filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_staff", filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_table_waiter_assignments", filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "manager_customer_complaints", filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "manager_ai_recommendation_decisions", filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refresh, restaurantId]);

  async function decide(recommendation: ManagerAiRecommendation, decision: AiDecision) {
    try {
      setNotice(null);
      setError(null);
      await logManagerAiDecision(restaurantId, recommendation, decision);
      setNotice(decision === "applied" ? "Recommendation marked for manager-approved action." : decision === "ignored" ? "Recommendation ignored." : "Reminder scheduled for 30 minutes.");
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : "Could not log AI recommendation decision.");
    }
  }

  const criticalAlerts = (snapshot?.alerts ?? []).filter((alert) => alert.priority === "critical");

  return (
    <main className="mai-page">
      <header className="mai-header">
        <div>
          <span>AI Operations Assistant</span>
          <h1>{restaurantName}</h1>
          <p>{managerName} · advisory only · manager approval required</p>
        </div>
        <div className={`mai-health-pill ${scoreClass(snapshot?.health.overall ?? 100)}`}>
          <small>Restaurant Health</small>
          <strong>{snapshot?.health.overall ?? 0}%</strong>
          <em>{snapshot?.health.trend ?? "steady"}</em>
        </div>
      </header>

      {(notice || error) && <div className={`mai-message ${error ? "error" : ""}`}>{error || notice}</div>}

      {criticalAlerts.length > 0 && (
        <section className="mai-critical" aria-label="Pinned critical AI alerts">
          {criticalAlerts.slice(0, 3).map((alert) => (
            <article key={alert.id}>
              <b>{priorityLabel(alert.priority)}</b>
              <strong>{alert.description}</strong>
              <p>{alert.suggestedAction}</p>
            </article>
          ))}
        </section>
      )}

      <section className="mai-grid">
        <section className="mai-panel mai-alerts">
          <div className="mai-panel-head"><span>Live AI Alerts</span><h2>Operational alert center</h2></div>
          {(snapshot?.alerts ?? []).map((alert) => (
            <article key={alert.id} className={`mai-alert ${alert.priority}`}>
              <div><b>{priorityLabel(alert.priority)}</b><time>{new Date(alert.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div>
              <strong>{alert.description}</strong>
              <p>{alert.affectedArea} · {alert.suggestedAction}</p>
            </article>
          ))}
          {snapshot?.alerts.length === 0 && <p className="mai-empty">No live AI alerts. Continue monitoring operations.</p>}
        </section>

        <section className="mai-panel mai-recommendations">
          <div className="mai-panel-head"><span>AI Recommendations</span><h2>Manager-approved actions</h2></div>
          {(snapshot?.recommendations ?? []).map((recommendation) => (
            <article key={recommendation.id} className={`mai-rec ${recommendation.priority}`}>
              <div><b>{priorityLabel(recommendation.priority)}</b><em>{recommendation.confidence}% confidence</em></div>
              <h3>{recommendation.recommendation}</h3>
              <p><strong>Reason:</strong> {recommendation.reason}</p>
              <p><strong>Expected benefit:</strong> {recommendation.expectedBenefit}</p>
              <div className="mai-rec-actions">
                <button type="button" onClick={() => void decide(recommendation, "applied")}>Apply</button>
                <button type="button" onClick={() => void decide(recommendation, "ignored")}>Ignore</button>
                <button type="button" onClick={() => void decide(recommendation, "remind_later")}>Remind Later</button>
              </div>
            </article>
          ))}
        </section>

        <section className="mai-panel mai-health">
          <div className="mai-panel-head"><span>Restaurant Health</span><h2>{snapshot?.health.overall ?? 0}% overall</h2></div>
          {(snapshot?.health.breakdown ?? []).map((item) => (
            <div className="mai-health-row" key={item.label}>
              <div><strong>{item.label}</strong><span>{item.trend}</span></div>
              <meter min={0} max={100} value={item.score} className={scoreClass(item.score)} />
              <b>{item.score}%</b>
            </div>
          ))}
        </section>

        <section className="mai-panel mai-predictions">
          <div className="mai-panel-head"><span>AI Predictions</span><h2>Next operational risks</h2></div>
          {(snapshot?.predictions ?? []).map((prediction) => (
            <article key={prediction.id} className={`mai-prediction ${prediction.priority}`}>
              <div><b>{priorityLabel(prediction.priority)}</b><em>{prediction.confidence}%</em></div>
              <strong>{prediction.prediction}</strong>
              <p>{prediction.reason}</p>
            </article>
          ))}
        </section>

        <section className="mai-panel mai-learning">
          <div className="mai-panel-head"><span>AI Learning</span><h2>Learned from this restaurant</h2></div>
          {(snapshot?.learning ?? []).map((learning) => (
            <article key={learning.id}>
              <strong>{learning.learning}</strong>
              <p><b>Reason:</b> {learning.reason}</p>
              <p><b>Suggested improvement:</b> {learning.suggestedImprovement}</p>
              <time>{new Date(learning.dateLearned).toLocaleDateString()}</time>
            </article>
          ))}
          {snapshot?.learning.length === 0 && <p className="mai-empty">More historical activity is needed before restaurant-specific patterns are reliable.</p>}
        </section>
      </section>
    </main>
  );
}
