import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ArrowRight, Bot, RotateCw, Send, Sparkles, X } from "lucide-react";
import { useModalFocus } from "../../../core/accessibility/useModalFocus";
import type { CurrencyConfig } from "../../../core/format/currency";
import { useTenantRealtime } from "../../../core/realtime/useTenantRealtime";
import { supabase } from "../../../core/database";
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
import {
  beginCopilotDiagnostic,
  currentCopilotDiagnosticFlow,
  getCopilotDiagnosticAttempt,
  recordCopilotCheckpoint,
  recordCopilotFailure,
  subscribeCopilotDiagnostics,
  type CopilotDiagnosticAttempt,
  type CopilotDiagnosticFlow,
} from "../managerCopilotDiagnostics";

type Props = {
  restaurantId: string;
  restaurantName: string;
  managerName: string;
  section: string;
  currency?: CurrencyConfig;
  snapshotLoader?: typeof loadManagerCopilotSnapshot;
  questionInvestigator?: typeof investigateManagerQuestion;
  realtimeEnabled?: boolean;
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
  snapshotLoader = loadManagerCopilotSnapshot,
  questionInvestigator = investigateManagerQuestion,
  realtimeEnabled = true,
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
  const [selectedUpdate, setSelectedUpdate] = useState<{
    title: string;
    context: CopilotContext;
  } | null>(null);
  const [snapshot, setSnapshot] = useState<ManagerCopilotSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedQuestion, setFailedQuestion] = useState<{
    text: string;
    context: CopilotContext;
  } | null>(null);
  const [draft, setDraft] = useState("");
  const [debugOpen, setDebugOpen] = useState(false);
  const [authenticated, setAuthenticated] = useState<"unknown" | "yes" | "no">(
    "unknown",
  );
  const [snapshotDiagnosticStatus, setSnapshotDiagnosticStatus] = useState<
    "idle" | "loading" | "success" | "failed"
  >("idle");
  const [copilotDiagnosticStatus, setCopilotDiagnosticStatus] = useState<
    "idle" | "thinking" | "complete" | "failed"
  >("idle");
  const [online, setOnline] = useState(() => navigator.onLine);
  const [messages, setMessages] = useState<Message[]>(() =>
    restoreMessages(restaurantId),
  );
  const conversationRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const snapshotRef = useRef<ManagerCopilotSnapshot | null>(null);
  const snapshotRequestRef = useRef<Promise<ManagerCopilotSnapshot> | null>(null);
  const submittingRef = useRef(false);
  const pendingAnswerRenderRef = useRef(false);
  const diagnosticAttempt = useSyncExternalStore(
    subscribeCopilotDiagnostics,
    getCopilotDiagnosticAttempt,
    getCopilotDiagnosticAttempt,
  );

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      setAuthenticated(data.session ? "yes" : "no");
      if (sessionError) {
        console.error("[ManagerCopilot] session diagnostic failed", sessionError);
      }
    });
  }, []);
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const closeCopilot = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => launcherRef.current?.focus());
  }, []);
  useModalFocus(open, closeCopilot, panelRef, closeButtonRef);

  const loadSnapshot = useCallback(
    async (force = false) => {
      const flow = currentCopilotDiagnosticFlow();
      if (import.meta.env.DEV) {
        recordCopilotCheckpoint("Snapshot requested", "pending", flow);
      }
      if (!force && snapshotRef.current) {
        if (import.meta.env.DEV) {
          recordCopilotCheckpoint("Snapshot requested", "success", flow);
          recordCopilotCheckpoint("Snapshot succeeded", "success", flow);
        }
        setSnapshotDiagnosticStatus("success");
        return snapshotRef.current;
      }
      if (snapshotRequestRef.current) return snapshotRequestRef.current;
      setSnapshotLoading(true);
      setSnapshotDiagnosticStatus("loading");
      const request = snapshotLoader(restaurantId)
        .then((nextSnapshot) => {
          snapshotRef.current = nextSnapshot;
          setSnapshot(nextSnapshot);
          setError(null);
          setSnapshotDiagnosticStatus("success");
          if (import.meta.env.DEV) {
            recordCopilotCheckpoint("Snapshot requested", "success", flow);
            recordCopilotCheckpoint("Snapshot succeeded", "success", flow);
          }
          return nextSnapshot;
        })
        .catch((loadError) => {
          console.error("[ManagerCopilot] authorized snapshot load failed", loadError);
          setError("Couldn't load current operations. Try again.");
          setSnapshotDiagnosticStatus("failed");
          if (import.meta.env.DEV) {
            recordCopilotFailure(
              "Snapshot failed",
              "Manager operational data could not be loaded.",
              loadError,
              flow,
            );
          }
          throw loadError;
        })
        .finally(() => {
          snapshotRequestRef.current = null;
          setSnapshotLoading(false);
        });
      snapshotRequestRef.current = request;
      return request;
    },
    [restaurantId, snapshotLoader],
  );
  const refresh = useCallback(async () => {
    if (!open) return;
    try {
      await loadSnapshot(true);
    } catch {
      // loadSnapshot renders a safe retry state and logs developer diagnostics.
    }
  }, [loadSnapshot, open]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const copilotRealtimeState = useTenantRealtime({
    channelName: "manager-global-copilot",
    restaurantId,
    enabled: open && realtimeEnabled,
    tables: ["inventory_items", "inventory_movements"],
    refresh,
    refreshOnConnect: false,
  });
  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent<OpenManagerCopilotDetail>).detail;
      const nextContext = detail?.context ?? context;
      if (import.meta.env.DEV && detail?.updateId) {
        if (currentCopilotDiagnosticFlow() !== "notification") {
          beginCopilotDiagnostic("notification");
        }
        recordCopilotCheckpoint("Context attached", "success", "notification");
      }
      setActiveContext(nextContext);
      setSelectedUpdate(
        detail?.title ? { title: detail.title, context: nextContext } : null,
      );
      if (detail?.prompt) {
        setQueuedQuestion({ text: detail.prompt, context: nextContext });
      }
      setOpen(true);
    };
    window.addEventListener("serveflow:open-copilot", show);
    return () => window.removeEventListener("serveflow:open-copilot", show);
  }, [context]);
  useEffect(() => {
    if (!open || !import.meta.env.DEV) return;
    recordCopilotCheckpoint(
      "Copilot opened",
      "success",
      currentCopilotDiagnosticFlow(),
    );
  }, [open]);
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
  }, [messages, snapshotLoading, submitting]);
  useEffect(() => {
    if (!pendingAnswerRenderRef.current || !import.meta.env.DEV) return;
    pendingAnswerRenderRef.current = false;
    const flow = currentCopilotDiagnosticFlow();
    recordCopilotCheckpoint(
      flow === "notification" ? "Answer rendered" : "Render completed",
      "success",
      flow,
    );
  }, [messages]);
  useEffect(() => {
    if (!open) return;
    document.documentElement.classList.add("manager-copilot-open");
    const viewport = window.visualViewport;
    const syncViewport = () => {
      const height = viewport?.height ?? window.innerHeight;
      if (!Number.isFinite(height) || height < 240) return;
      document.documentElement.style.setProperty(
        "--mcp-viewport-height",
        `${height}px`,
      );
    };
    syncViewport();
    viewport?.addEventListener("resize", syncViewport);
    return () => {
      document.documentElement.classList.remove("manager-copilot-open");
      document.documentElement.style.removeProperty("--mcp-viewport-height");
      viewport?.removeEventListener("resize", syncViewport);
    };
  }, [open]);

  const prompts = useMemo(
    () => suggestions[activeContext] ?? suggestions.dashboard,
    [activeContext],
  );
  const sendQuestion = useCallback(
    async (
      value: string,
      questionContext: CopilotContext,
      appendManagerMessage = true,
    ) => {
      const question = value.trim();
      if (!question || submittingRef.current) return;
      const flow = currentCopilotDiagnosticFlow();
      if (import.meta.env.DEV) {
        recordCopilotCheckpoint("sendQuestion entered", "success", flow);
        recordCopilotCheckpoint(
          "Manager context available",
          managerName.trim() ? "success" : "failed",
          flow,
        );
        recordCopilotCheckpoint(
          "Restaurant context available",
          restaurantId.trim() ? "success" : "failed",
          flow,
        );
      }
      submittingRef.current = true;
      setSubmitting(true);
      setCopilotDiagnosticStatus("thinking");
      setError(null);
      setFailedQuestion(null);
      setDraft("");
      if (appendManagerMessage) {
        setMessages((current) => [
          ...current,
          { id: crypto.randomUUID(), role: "manager", text: question },
        ]);
      }
      let snapshotResolved = false;
      try {
        const authorizedSnapshot = snapshotRef.current ?? (await loadSnapshot());
        snapshotResolved = true;
        if (import.meta.env.DEV && snapshotRef.current) {
          recordCopilotCheckpoint("Snapshot requested", "success", flow);
          recordCopilotCheckpoint("Snapshot succeeded", "success", flow);
        }
        if (import.meta.env.DEV) {
          recordCopilotCheckpoint("Investigator started", "pending", flow);
        }
        const answer = questionInvestigator(
          question,
          authorizedSnapshot,
          currency,
          questionContext,
        );
        if (import.meta.env.DEV) {
          recordCopilotCheckpoint("Investigator started", "success", flow);
          recordCopilotCheckpoint("Investigator completed", "success", flow);
          recordCopilotCheckpoint("Answer committed to state", "success", flow);
        }
        pendingAnswerRenderRef.current = true;
        setMessages((current) => [
          ...current,
          { id: crypto.randomUUID(), role: "copilot", answer },
        ]);
        setCopilotDiagnosticStatus("complete");
      } catch (questionError) {
        console.error("[ManagerCopilot] question failed", questionError);
        setFailedQuestion({ text: question, context: questionContext });
        setError("Couldn't load this answer. Try again.");
        setCopilotDiagnosticStatus("failed");
        if (import.meta.env.DEV && snapshotResolved) {
          recordCopilotFailure(
            "sendQuestion entered",
            "The Copilot answer could not be completed.",
            questionError,
            flow,
          );
        }
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [
      currency,
      loadSnapshot,
      managerName,
      questionInvestigator,
      restaurantId,
    ],
  );

  useEffect(() => {
    if (!open || !queuedQuestion || submittingRef.current) return;
    const question = queuedQuestion;
    setQueuedQuestion(null);
    if (import.meta.env.DEV) {
      recordCopilotCheckpoint(
        "Contextual send started",
        "success",
        "notification",
      );
    }
    void sendQuestion(question.text, question.context);
  }, [open, queuedQuestion, sendQuestion]);
  function navigate(href: string) {
    window.history.pushState({}, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
    setOpen(false);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (import.meta.env.DEV) {
      recordCopilotCheckpoint("Send tapped", "success", "manual");
    }
    void sendQuestion(draft, activeContext);
  }
  const showStarter =
    messages.length === 0 &&
    !selectedUpdate &&
    !snapshotLoading &&
    !submitting &&
    !error;
  const hasVisibleConversationState = Boolean(
    showStarter ||
      selectedUpdate ||
      messages.length ||
      snapshotLoading ||
      submitting ||
      error,
  );

  return (
    <>
      <button
        className="mcp-launcher"
        ref={launcherRef}
        type="button"
        onClick={() => {
          if (import.meta.env.DEV) beginCopilotDiagnostic("manual");
          setActiveContext(context);
          setQueuedQuestion(null);
          setSelectedUpdate(null);
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
              <div className="mcp-header-actions">
                {import.meta.env.DEV && (
                  <button type="button" onClick={() => setDebugOpen(true)}>
                    Debug
                  </button>
                )}
                <button
                  ref={closeButtonRef}
                  type="button"
                  onClick={closeCopilot}
                  aria-label="Close Copilot"
                >
                  <X />
                </button>
              </div>
            </header>
            {import.meta.env.DEV && debugOpen && (
              <CopilotDiagnosticSheet
                attempt={diagnosticAttempt}
                authenticated={authenticated}
                managerReady={Boolean(managerName.trim())}
                restaurantReady={Boolean(restaurantId.trim())}
                snapshotStatus={snapshotDiagnosticStatus}
                copilotStatus={copilotDiagnosticStatus}
                realtimeStatus={
                  !online || !realtimeEnabled
                    ? "Disconnected"
                    : copilotRealtimeState === "connected"
                      ? "Connected"
                      : "Reconnecting"
                }
                onClose={() => setDebugOpen(false)}
              />
            )}
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
              {selectedUpdate && (
                <article className="mcp-update-context" role="status">
                  <span>Update needing review</span>
                  <strong>{selectedUpdate.title}</strong>
                  <small>
                    Copilot is checking authorized {contextLabels[selectedUpdate.context]} evidence.
                  </small>
                </article>
              )}
              {showStarter && (
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
                        disabled={submitting}
                        onClick={() =>
                          void sendQuestion(prompt, activeContext)
                        }
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
              {(snapshotLoading || submitting) && (
                <article className="mcp-message copilot loading">
                  <span>Copilot</span>
                  <p>
                    <i />
                    <i />
                    <i /> {submitting ? "Thinking..." : "Loading current operations..."}
                  </p>
                </article>
              )}
              {error && (
                <div className="mcp-error" role="alert">
                  <p>{managerFacingMessage(error, "Couldn't load this answer. Try again.")}</p>
                  <button
                    type="button"
                    onClick={() =>
                      failedQuestion
                        ? void sendQuestion(
                            failedQuestion.text,
                            failedQuestion.context,
                            false,
                          )
                        : void refresh()
                    }
                  >
                    <RotateCw /> Retry
                  </button>
                </div>
              )}
              {!hasVisibleConversationState && (
                <div className="mcp-empty mcp-render-guard" role="status">
                  <h2>Copilot is ready.</h2>
                  <p>Ask about current operations below.</p>
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
                  onChange={(event) => {
                    setDraft(event.target.value);
                    if (import.meta.env.DEV) {
                      recordCopilotCheckpoint(
                        "Input changed",
                        "success",
                        currentCopilotDiagnosticFlow(),
                      );
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendQuestion(draft, activeContext);
                    }
                  }}
                  placeholder="Ask about current operations…"
                />
              </label>
              <button
                type="submit"
                disabled={!draft.trim() || submitting}
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

const manualDiagnosticCheckpoints = [
  "Copilot opened",
  "Input changed",
  "Send tapped",
  "sendQuestion entered",
  "Manager context available",
  "Restaurant context available",
  "Snapshot requested",
  "Snapshot succeeded",
  "Snapshot failed",
  "Investigator started",
  "Investigator completed",
  "Answer committed to state",
  "Render completed",
];

const notificationDiagnosticCheckpoints = [
  "Realtime update received",
  "Notification created",
  "Notification tapped",
  "Copilot open requested",
  "Copilot opened",
  "Context attached",
  "Contextual send started",
  "Snapshot requested",
  "Investigator started",
  "Answer rendered",
];

function CopilotDiagnosticSheet({
  attempt,
  authenticated,
  managerReady,
  restaurantReady,
  snapshotStatus,
  copilotStatus,
  realtimeStatus,
  onClose,
}: {
  attempt: CopilotDiagnosticAttempt | null;
  authenticated: "unknown" | "yes" | "no";
  managerReady: boolean;
  restaurantReady: boolean;
  snapshotStatus: "idle" | "loading" | "success" | "failed";
  copilotStatus: "idle" | "thinking" | "complete" | "failed";
  realtimeStatus: "Connected" | "Reconnecting" | "Disconnected";
  onClose: () => void;
}) {
  const flow: CopilotDiagnosticFlow = attempt?.flow ?? "manual";
  const checkpoints =
    flow === "notification"
      ? notificationDiagnosticCheckpoints
      : manualDiagnosticCheckpoints;
  const entries = new Map(
    attempt?.entries.map((entry) => [entry.checkpoint, entry]) ?? [],
  );
  return (
    <section
      className="mcp-diagnostic"
      role="region"
      aria-label="Copilot mobile diagnostic"
    >
      <header>
        <div>
          <strong>Copilot diagnostic</strong>
          <small>{flow === "notification" ? "Notification" : "Manual send"}</small>
        </div>
        <button type="button" onClick={onClose}>Close</button>
      </header>
      <div className="mcp-diagnostic-scroll">
        <dl className="mcp-diagnostic-build">
          <div><dt>Build mode</dt><dd>Development</dd></div>
          <div><dt>Build timestamp</dt><dd>{__SERVEFLOW_BUILD_ID__}</dd></div>
        </dl>
        <dl className="mcp-diagnostic-context">
          <DiagnosticStatus label="Authenticated" value={authenticated === "unknown" ? "Checking" : authenticated === "yes" ? "Yes" : "No"} />
          <DiagnosticStatus label="Manager context" value={managerReady ? "Ready" : "Missing"} />
          <DiagnosticStatus label="Restaurant context" value={restaurantReady ? "Ready" : "Missing"} />
          <DiagnosticStatus label="Restaurant ID" value={restaurantReady ? "Present" : "Missing"} />
          <DiagnosticStatus label="Snapshot" value={capitalize(snapshotStatus)} />
          <DiagnosticStatus label="Copilot" value={capitalize(copilotStatus)} />
          <DiagnosticStatus label="Realtime" value={realtimeStatus} />
        </dl>
        <ol className="mcp-diagnostic-checkpoints">
          {checkpoints.map((checkpoint) => {
            const entry = entries.get(checkpoint);
            const symbol = !entry
              ? "—"
              : entry.status === "failed"
                ? "✕"
                : entry.status === "pending"
                  ? "…"
                  : "✓";
            return (
              <li className={entry?.status ?? "unreached"} key={checkpoint}>
                <span aria-hidden="true">{symbol}</span>
                <b>{checkpoint}</b>
                <time>{entry ? `${entry.elapsedMs} ms` : "Not reached"}</time>
              </li>
            );
          })}
        </ol>
        {attempt?.error && (
          <div className="mcp-diagnostic-error" role="alert">
            <strong>Sanitized error</strong>
            <dl>
              <DiagnosticStatus label="Stage" value={attempt.error.stage} />
              <DiagnosticStatus label="Error type" value={attempt.error.type} />
              <DiagnosticStatus label="Safe message" value={attempt.error.safeMessage} />
            </dl>
          </div>
        )}
      </div>
    </section>
  );
}

function DiagnosticStatus({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
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
