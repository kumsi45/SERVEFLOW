import { useCallback, useEffect, useMemo, useState } from "react";
import { useTenantRealtime } from "../../../core/realtime/useTenantRealtime";
import { formatCurrency, type CurrencyConfig } from "../../../core/format/currency";
import { logManagerAiDecision, type AiDecision, type ManagerAiOperationsSnapshot, type ManagerAiRecommendation } from "../services/managerAiOperationsService";
import { loadRestaurantIntelligence, type RestaurantIntelligenceSnapshot } from "../services/managerRestaurantIntelligenceService";
import "../styles/managerAiOperations.css";
import { managerFacingMessage } from "../managerPresentation";

type Props = { restaurantId: string; restaurantName: string; managerName: string; currency?: CurrencyConfig };
type ChatMessage = { id: string; role: "manager" | "copilot"; text: string };
const SUGGESTIONS = ["Delayed Orders", "Kitchen Status", "Inventory", "Staff", "Revenue", "VIP Tables", "Complaints"];

function scoreClass(score: number) { return score >= 85 ? "green" : score >= 70 ? "yellow" : "red"; }
function priorityLabel(priority: string) { return priority.replace("_", " "); }
function greeting() { const hour = new Date().getHours(); return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"; }

function answerFromSnapshot(question: string, snapshot: ManagerAiOperationsSnapshot | null, intelligence: RestaurantIntelligenceSnapshot | null) {
  if (!snapshot) return "Live restaurant data is still loading. Please try again in a moment.";
  const query = question.toLowerCase();
  const alerts = snapshot.alerts;
  const describe = (matches: typeof alerts, empty: string) => matches.length ? matches.slice(0, 5).map((alert) => `${alert.description}: ${alert.suggestedAction}`).join("\n") : empty;
  if (query.includes("inventory") || query.includes("ingredient") || query.includes("stock") || query.includes("supplier")) { const module = intelligence?.modules.find((item) => item.key === "inventory"); return module ? `${module.summary}\n${module.actions.length ? module.actions.join("\n") : "No inventory intervention is recommended."}${module.confidence != null ? `\nConfidence: ${module.confidence}%` : ""}` : "Inventory intelligence is still loading."; }
  if (query.includes("revenue") || query.includes("sales")) { const module = intelligence?.modules.find((item) => item.key === "revenue"); return module ? `${module.summary}\n${module.actions.length ? module.actions.join("\n") : "No revenue intervention is recommended from the current evidence."}${module.confidence != null ? `\nConfidence: ${module.confidence}%` : ""}` : "Revenue intelligence is still loading."; }
  if (query.includes("rush") || query.includes("traffic")) { const module = intelligence?.modules.find((item) => item.key === "traffic"); return module ? `${module.summary}\n${module.actions.join("\n")}${module.confidence != null ? `\nConfidence: ${module.confidence}%` : ""}` : "Traffic intelligence is still loading."; }
  if (query.includes("overload") && query.includes("waiter")) return describe(alerts.filter((alert) => alert.affectedArea === "Waiters"), "No waiter overload alert is active. The live service flags waiters at eight or more assigned tables.");
  if (query.includes("delayed") || query.includes("late order")) return describe(alerts.filter((alert) => alert.affectedArea === "Kitchen" || alert.affectedArea === "Dining Flow"), "No delayed-order or prolonged-table alert is active.");
  if (query.includes("station") || query.includes("kitchen")) { const score = snapshot.health.breakdown.find((item) => item.label === "Kitchen"); return `${score ? `Kitchen health is ${score.score}% (${score.trend}).\n` : ""}${describe(alerts.filter((alert) => alert.affectedArea === "Kitchen"), "No kitchen station pressure alert is active.")}`; }
  if (query.includes("pending bill") || query.includes("cashier") || query.includes("payment")) return describe(alerts.filter((alert) => alert.affectedArea === "Cashier"), "No overdue bill or cashier queue alert is active.");
  if (query.includes("vip")) return describe(alerts.filter((alert) => alert.description.toLowerCase().includes("vip")), "No VIP waiting alert is active.");
  if (query.includes("complaint")) { const complaint = snapshot.recommendations.filter((item) => item.id.includes("complaint")); return complaint.length ? complaint.map((item) => `${item.recommendation} ${item.reason}`).join("\n") : "No unresolved complaint recommendation is active."; }
  if (query.includes("table") || query.includes("waited longest") || query.includes("attention")) return describe(alerts.filter((alert) => alert.affectedArea === "Dining Flow" || alert.affectedArea === "Customer Service"), "No table currently exceeds the service-attention thresholds.");
  if (query.includes("staff") || query.includes("waiter")) { const score = snapshot.health.breakdown.find((item) => item.label === "Waiters"); return `${score ? `Waiter coverage health is ${score.score}% (${score.trend}).\n` : ""}${describe(alerts.filter((alert) => alert.affectedArea === "Waiters"), "No waiter workload alert is active.")}`; }
  return "I can answer about traffic and rush periods, delayed orders, kitchen stations, staff workload, tables, pending bills, VIP guests, complaints, revenue forecasts, and inventory depletion using supported restaurant data.";
}

export function ManagerAiOperationsPage({ restaurantId, managerName, currency }: Props) {
  const [snapshot, setSnapshot] = useState<ManagerAiOperationsSnapshot | null>(null);
  const [intelligence, setIntelligence] = useState<RestaurantIntelligenceSnapshot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const refresh = useCallback(async () => { try { const next = await loadRestaurantIntelligence(restaurantId); setIntelligence(next); setSnapshot(next.operations); setError(null); } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Operations Copilot unavailable."); } }, [restaurantId]);
  useEffect(() => { void refresh(); }, [refresh]);
  useTenantRealtime({ channelName: "manager-ai-operations", restaurantId, tables: ["orders", "order_items", "order_invoices", "kitchen_stations", "restaurant_staff", "restaurant_table_waiter_assignments", "manager_customer_complaints", "kitchen_inventory_requests", "inventory_items", "manager_ai_recommendation_decisions"], refresh });

  const health = useMemo(() => new Map((snapshot?.health.breakdown ?? []).map((item) => [item.label, item])), [snapshot]);
  const problems = snapshot?.alerts.length ?? 0;
  async function decide(recommendation: ManagerAiRecommendation, decision: AiDecision) { try { setNotice(null); setError(null); await logManagerAiDecision(restaurantId, recommendation, decision); setNotice(decision === "applied" ? "Manager-approved action recorded." : decision === "ignored" ? "Recommendation dismissed." : "Reminder scheduled for 30 minutes."); await refresh(); } catch (decisionError) { setError(decisionError instanceof Error ? decisionError.message : "Could not record this decision."); } }
  function ask(value = draft) { const question = value.trim(); if (!question) return; setMessages((current) => [...current, { id: crypto.randomUUID(), role: "manager", text: question }, { id: crypto.randomUUID(), role: "copilot", text: answerFromSnapshot(question, snapshot, intelligence) }]); setDraft(""); }

  return <main className="cop-page">
    <section className="cop-welcome"><div><span>Operations Copilot</span><h1>{greeting()}, {managerName}.</h1><p>Manager approval is required for every action.</p></div><div className={`cop-health ${scoreClass(snapshot?.health.overall ?? 0)}`}><strong>{snapshot?.health.overall ?? 0}%</strong><span>Operation health</span></div></section>
    {(notice || error) && <div className={`cop-message ${error ? "error" : ""}`}>{error ? managerFacingMessage(error, "Operations Copilot is unavailable. Try again.") : notice}</div>}
    <section className="cop-summary" aria-label="Today's restaurant summary">
      <article><span>Revenue</span><strong>{formatCurrency(intelligence?.today.summary.revenue ?? 0, currency)}</strong><small>Live total</small></article>
      <article><span>Kitchen</span><strong>{health.get("Kitchen")?.score ?? 0}%</strong><small>{health.get("Kitchen")?.trend ?? "Loading"}</small></article>
      <article><span>Staff</span><strong>{health.get("Waiters")?.score ?? 0}%</strong><small>Waiter coverage</small></article>
      <article><span>Inventory</span><strong>{intelligence?.inventory.filter((item) => item.health === "critical" || item.health === "low").length ?? 0} at risk</strong><small>Predictive stock health</small></article>
      <article><span>Customer Satisfaction</span><strong>{health.get("Customer Service")?.score ?? 0}%</strong><small>Service health</small></article>
      <article className={problems ? "has-problems" : ""}><span>Problems Detected</span><strong>{problems}</strong><small>{problems ? "Needs review" : "All clear"}</small></article>
    </section>
    <section className="cop-layout">
      <aside className="cop-actions"><header><div><span>Recommended Actions</span><h2>Manager decision queue</h2></div><b>{snapshot?.recommendations.length ?? 0}</b></header><div>{(snapshot?.recommendations ?? []).map((recommendation) => <article key={recommendation.id} className={recommendation.priority}><div><b>{priorityLabel(recommendation.priority)}</b><em>{recommendation.confidence}% confidence</em></div><h3>{recommendation.recommendation}</h3><p>{recommendation.reason}</p><small>{recommendation.expectedBenefit}</small><footer><button type="button" onClick={() => void decide(recommendation, "applied")}>Approve</button><button type="button" onClick={() => void decide(recommendation, "remind_later")}>Later</button><button type="button" onClick={() => void decide(recommendation, "ignored")}>Dismiss</button></footer></article>)}{snapshot?.recommendations.length === 0 && <p className="cop-empty">No manager action is recommended right now.</p>}</div></aside>
      <section className="cop-chat"><header><div><span>Live Operational Intelligence</span><strong>Business data up to date</strong></div><i /></header><div className="cop-conversation"><article className="copilot"><span>Copilot</span><p>{greeting()}. I&apos;m monitoring kitchen, service, staff, cashier, VIP, and complaint signals. What would you like to inspect?</p></article>{messages.map((message) => <article key={message.id} className={message.role}><span>{message.role === "manager" ? "You" : "Copilot"}</span>{message.text.split("\n").map((line) => <p key={line}>{line}</p>)}</article>)}</div><div className="cop-suggestions">{SUGGESTIONS.map((suggestion) => <button type="button" key={suggestion} onClick={() => ask(suggestion)}>{suggestion}</button>)}</div><form onSubmit={(event) => { event.preventDefault(); ask(); }}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask about live operations..." aria-label="Ask Operations Copilot" /><button type="submit">Send</button></form></section>
    </section>
  </main>;
}
