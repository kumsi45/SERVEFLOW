import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowRight, Bot, RotateCw, Send, Sparkles, X } from "lucide-react";
import { useModalFocus } from "../../../core/accessibility/useModalFocus";
import type { CurrencyConfig } from "../../../core/format/currency";
import { useTenantRealtime } from "../../../core/realtime/useTenantRealtime";
import {
  investigateManagerQuestion,
  loadManagerCopilotSnapshot,
  type CopilotAnswer,
  type CopilotContext,
  type ManagerCopilotSnapshot,
} from "../services/managerCopilotService";
import "../styles/managerCopilot.css";
import { managerFacingMessage } from "../managerPresentation";
import type { OpenManagerCopilotDetail } from "../managerLiveUpdates";

type Props = {
  restaurantId: string;
  restaurantName: string;
  managerName: string;
  section: string;
  currency?: CurrencyConfig;
};
type Message =
  | { id: string; role: "manager"; text: string }
  | { id: string; role: "copilot"; answer: CopilotAnswer };

const contextLabels: Record<string, string> = {
  dashboard: "Dashboard",
  tables: "Live Operations",
  kitchen: "Kitchen",
  staff: "Staff",
  customers: "Guests",
  reports: "Reports",
  intelligence: "Business Intelligence",
  recipes: "Recipes",
  menu: "Menu",
  inventory: "Inventory",
  ai: "Dashboard",
};
const suggestions: Record<string, string[]> = {
  dashboard: [
    "What needs attention?",
    "Delayed orders",
    "Inventory risks",
    "Staff workload",
    "Today's sales",
  ],
  tables: [
    "What needs attention?",
    "Which tables have waited longest?",
    "Who is overloaded?",
    "Any bill requests waiting?",
  ],
  kitchen: [
    "Why are orders delayed?",
    "Which station is slowest?",
    "Kitchen requests",
    "Current prep time",
  ],
  staff: [
    "Who is overloaded?",
    "Who is available?",
    "Workload balance",
    "Who handled the most work today?",
  ],
  customers: [
    "Who needs attention?",
    "Longest waiting tables",
    "Any complaints?",
    "Pending special requests",
  ],
  inventory: [
    "What is low?",
    "What may run out?",
    "Pending requests",
    "What may be needed tomorrow?",
  ],
  menu: [
    "Best sellers today?",
    "Slow sellers?",
    "Unavailable items",
    "Items affected by stock",
  ],
  reports: [
    "Summarize today",
    "Biggest operational problem?",
    "When was our busiest period?",
    "What should I improve tomorrow?",
  ],
  intelligence: [
    "Explain the biggest operational problem",
    "Why is this happening?",
    "Show the evidence",
    "What should I do?",
  ],
  recipes: [
    "Items affected by stock",
    "Inventory risks",
    "What may run out?",
    "Unavailable items",
  ],
};

export function ManagerCopilot({
  restaurantId,
  managerName,
  section,
  currency,
}: Props) {
  const context = (
    section === "ai" ? "dashboard" : section === "cashier" ? "tables" : section
  ) as CopilotContext;
  const [open, setOpen] = useState(section === "ai");
  const [activeContext, setActiveContext] = useState(context);
  const [queuedQuestion, setQueuedQuestion] = useState<{
    text: string;
    context: CopilotContext;
  } | null>(null);
  const [snapshot, setSnapshot] = useState<ManagerCopilotSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>(() =>
    restoreMessages(restaurantId),
  );
  const conversationRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);

  const closeCopilot = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => launcherRef.current?.focus());
  }, []);
  useModalFocus(open, closeCopilot, panelRef, composerRef);

  const refresh = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      setSnapshot(await loadManagerCopilotSnapshot(restaurantId));
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "ServeFlow Copilot could not load operational evidence.",
      );
    } finally {
      setLoading(false);
    }
  }, [open, restaurantId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useTenantRealtime({
    channelName: "manager-global-copilot",
    restaurantId,
    enabled: open,
    tables: ["inventory_items", "inventory_movements"],
    refresh,
    refreshOnConnect: false,
  });
  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent<OpenManagerCopilotDetail>).detail;
      const nextContext = detail?.context ?? context;
      setActiveContext(nextContext);
      if (detail?.prompt) {
        setQueuedQuestion({ text: detail.prompt, context: nextContext });
      }
      setOpen(true);
    };
    window.addEventListener("serveflow:open-copilot", show);
    return () => window.removeEventListener("serveflow:open-copilot", show);
  }, [context]);
  useEffect(() => {
    if (section === "ai") setOpen(true);
    if (!open) setActiveContext(context);
  }, [context, open, section]);
  useEffect(() => {
    if (!open) return;
    let timer: number | undefined;
    const refreshFromWorkspace = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), 150);
    };
    window.addEventListener(
      "serveflow:manager-data-changed",
      refreshFromWorkspace,
    );
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(
        "serveflow:manager-data-changed",
        refreshFromWorkspace,
      );
    };
  }, [open, refresh]);
  useEffect(() => {
    window.sessionStorage.setItem(
      storageKey(restaurantId),
      JSON.stringify(messages.slice(-40)),
    );
  }, [messages, restaurantId]);
  useEffect(() => {
    conversationRef.current?.scrollTo({
      top: conversationRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);
  useEffect(() => {
    if (!open) return;
    document.documentElement.classList.add("manager-copilot-open");
    const viewport = window.visualViewport;
    const syncViewport = () =>
      document.documentElement.style.setProperty(
        "--mcp-viewport-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
    syncViewport();
    viewport?.addEventListener("resize", syncViewport);
    return () => {
      document.documentElement.classList.remove("manager-copilot-open");
      document.documentElement.style.removeProperty("--mcp-viewport-height");
      viewport?.removeEventListener("resize", syncViewport);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !snapshot || loading || !queuedQuestion) return;
    const question = queuedQuestion;
    setQueuedQuestion(null);
    ask(question.text, question.context);
  }, [loading, open, queuedQuestion, snapshot]);

  const prompts = useMemo(
    () => suggestions[activeContext] ?? suggestions.dashboard,
    [activeContext],
  );
  function ask(value = draft, questionContext = activeContext) {
    const question = value.trim();
    if (!question || loading) return;
    const managerMessage: Message = {
      id: crypto.randomUUID(),
      role: "manager",
      text: question,
    };
    if (!snapshot) {
      setMessages((current) => [...current, managerMessage]);
      setDraft("");
      setLoading(true);
      setError(null);
      void loadManagerCopilotSnapshot(restaurantId)
        .then((nextSnapshot) => {
          setSnapshot(nextSnapshot);
          const answer = investigateManagerQuestion(
            question,
            nextSnapshot,
            currency,
            questionContext,
          );
          setMessages((current) => [
            ...current,
            { id: crypto.randomUUID(), role: "copilot", answer },
          ]);
        })
        .catch((loadError) => {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "ServeFlow Copilot could not answer this question.",
          );
        })
        .finally(() => setLoading(false));
      return;
    }
    const answer = investigateManagerQuestion(
      question,
      snapshot,
      currency,
      questionContext,
    );
    setMessages((current) => [
      ...current,
      managerMessage,
      { id: crypto.randomUUID(), role: "copilot", answer },
    ]);
    setDraft("");
  }
  function navigate(href: string) {
    window.history.pushState({}, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
    setOpen(false);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    ask();
  }

  return (
    <>
      <button
        className="mcp-launcher"
        ref={launcherRef}
        type="button"
        onClick={() => {
          setActiveContext(context);
          setQueuedQuestion(null);
          setOpen(true);
        }}
        aria-label="Open ServeFlow Copilot"
        aria-expanded={open}
      >
        <Sparkles aria-hidden="true" />
        <span>Copilot</span>
      </button>
      {open && (
        <div
          className="mcp-layer"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeCopilot();
          }}
        >
          <aside
            className="mcp-panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="ServeFlow Copilot"
            tabIndex={-1}
          >
            <header className="mcp-header">
              <div className="mcp-title">
                <span className="mcp-mark">
                  <Bot />
                </span>
                <div>
                  <strong>ServeFlow Copilot</strong>
                  <small>
                    <i /> Live operations
                    <b>{contextLabels[activeContext] ?? "Manager Workspace"}</b>
                  </small>
                </div>
              </div>
              <button
                type="button"
                onClick={closeCopilot}
                aria-label="Close Copilot"
              >
                <X />
              </button>
            </header>
            {snapshot?.unavailable.length ? (
              <div className="mcp-evidence-note" role="status">
                Some evidence unavailable: {snapshot.unavailable.join(", ")}
              </div>
            ) : null}
            <div
              className={`mcp-conversation ${messages.length ? "" : "is-empty"}`}
              ref={conversationRef}
              aria-live="polite"
            >
              {!messages.length && (
                <>
                  <div className="mcp-empty">
                    <h2>
                      {greeting()}, {firstName(managerName)}.
                    </h2>
                    <p>How can I help?</p>
                  </div>
                  <div
                    className="mcp-prompts"
                    aria-label={`${contextLabels[activeContext]} suggested questions`}
                  >
                    {prompts.map((prompt) => (
                      <button
                        type="button"
                        key={prompt}
                        disabled={loading}
                        onClick={() => ask(prompt)}
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {messages.map((message) =>
                message.role === "manager" ? (
                  <article className="mcp-message manager" key={message.id}>
                    <span>You</span>
                    <p>{message.text}</p>
                  </article>
                ) : (
                  <CopilotResponse
                    key={message.id}
                    answer={message.answer}
                    onNavigate={navigate}
                  />
                ),
              )}
              {loading && (
                <article className="mcp-message copilot loading">
                  <span>Copilot</span>
                  <p>
                    <i />
                    <i />
                    <i /> Investigating current ServeFlow data…
                  </p>
                </article>
              )}
              {error && (
                <div className="mcp-error" role="alert">
                  <p>{managerFacingMessage(error, "Copilot is unavailable right now. Try again.")}</p>
                  <button type="button" onClick={() => void refresh()}>
                    <RotateCw /> Retry
                  </button>
                </div>
              )}
            </div>
            <form className="mcp-composer" onSubmit={submit}>
              <label>
                <span className="sr-only">Ask ServeFlow Copilot</span>
                <textarea
                  ref={composerRef}
                  rows={1}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      ask();
                    }
                  }}
                  placeholder="Ask about current operations…"
                />
              </label>
              <button
                type="submit"
                disabled={!draft.trim() || loading}
                aria-label="Send question"
              >
                <Send />
              </button>
            </form>
            <footer className="mcp-disclaimer">
              Copilot uses available manager-authorized ServeFlow evidence.
              Review operational changes before acting.
            </footer>
          </aside>
        </div>
      )}
    </>
  );
}

function CopilotResponse({
  answer,
  onNavigate,
}: {
  answer: CopilotAnswer;
  onNavigate: (href: string) => void;
}) {
  return (
    <article className="mcp-message copilot">
      <span>Copilot</span>
      <section>
        <h3>Answer</h3>
        <p>{answer.conclusion}</p>
      </section>
      {answer.evidence.length > 0 && (
        <section>
          <h3>Evidence</h3>
          <ul>
            {answer.evidence.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </section>
      )}
      {answer.impact && (
        <section>
          <h3>Impact</h3>
          <p>{answer.impact}</p>
        </section>
      )}
      {answer.recommendation && (
        <section>
          <h3>Recommended action</h3>
          <p>{answer.recommendation}</p>
        </section>
      )}
      {answer.action && (
        <button
          className="mcp-action"
          type="button"
          onClick={() => onNavigate(answer.action!.href)}
        >
          {answer.action.label}
          <ArrowRight />
        </button>
      )}
      <footer>Based on: {answer.sources.join(" · ")}</footer>
    </article>
  );
}
function greeting() {
  const hour = new Date().getHours();
  return hour < 12
    ? "Good morning"
    : hour < 18
      ? "Good afternoon"
      : "Good evening";
}
function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || "Manager";
}
function storageKey(restaurantId: string) {
  return `serveflow.manager-copilot:${restaurantId}`;
}
function restoreMessages(restaurantId: string): Message[] {
  try {
    const value = JSON.parse(
      window.sessionStorage.getItem(storageKey(restaurantId)) ?? "[]",
    );
    return Array.isArray(value) ? (value.slice(-40) as Message[]) : [];
  } catch {
    return [];
  }
}
