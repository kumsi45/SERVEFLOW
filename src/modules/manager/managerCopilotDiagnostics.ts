export type CopilotDiagnosticFlow = "manual" | "notification";
export type CopilotDiagnosticStatus = "pending" | "success" | "failed";

export type CopilotDiagnosticEntry = {
  checkpoint: string;
  status: CopilotDiagnosticStatus;
  elapsedMs: number;
};

export type CopilotDiagnosticError = {
  stage: string;
  type: string;
  safeMessage: string;
};

export type CopilotDiagnosticAttempt = {
  flow: CopilotDiagnosticFlow;
  startedAt: number;
  entries: CopilotDiagnosticEntry[];
  error: CopilotDiagnosticError | null;
};

let attempt: CopilotDiagnosticAttempt | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function beginCopilotDiagnostic(flow: CopilotDiagnosticFlow) {
  if (!import.meta.env.DEV) return;
  attempt = { flow, startedAt: performance.now(), entries: [], error: null };
  notify();
}

export function recordCopilotCheckpoint(
  checkpoint: string,
  status: CopilotDiagnosticStatus = "success",
  flow: CopilotDiagnosticFlow = "manual",
) {
  if (!import.meta.env.DEV) return;
  if (!attempt || attempt.flow !== flow) beginCopilotDiagnostic(flow);
  if (!attempt) return;
  const existing = attempt.entries.find((entry) => entry.checkpoint === checkpoint);
  if (existing && existing.status === status) return;
  const entry = {
    checkpoint,
    status,
    elapsedMs: Math.max(0, Math.round(performance.now() - attempt.startedAt)),
  };
  attempt = {
    ...attempt,
    entries: existing
      ? attempt.entries.map((current) =>
          current.checkpoint === checkpoint ? entry : current,
        )
      : [...attempt.entries, entry],
  };
  notify();
}

export function recordCopilotFailure(
  stage: string,
  safeMessage: string,
  error?: unknown,
  flow?: CopilotDiagnosticFlow,
) {
  if (!import.meta.env.DEV) return;
  const activeFlow = flow ?? attempt?.flow ?? "manual";
  recordCopilotCheckpoint(stage, "failed", activeFlow);
  const type =
    error instanceof DOMException && error.name === "AbortError"
      ? "AbortError"
      : error instanceof Error && error.name === "TimeoutError"
        ? "TimeoutError"
        : "RuntimeError";
  attempt = attempt
    ? { ...attempt, error: { stage, type, safeMessage } }
    : attempt;
  notify();
}

export function getCopilotDiagnosticAttempt() {
  return attempt;
}

export function subscribeCopilotDiagnostics(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function currentCopilotDiagnosticFlow(): CopilotDiagnosticFlow {
  return attempt?.flow ?? "manual";
}
