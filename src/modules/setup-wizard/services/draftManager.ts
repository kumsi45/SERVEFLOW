import type { MenuReviewState } from "./menuReviewTypes";

export type DraftLifecycle =
  | "Editing"
  | "Saving..."
  | "Saved"
  | "Syncing..."
  | "Synced"
  | "Publishing..."
  | "Published";

type DraftSnapshot = {
  state: MenuReviewState;
  revision: number;
  fingerprint: string;
  lifecycle: DraftLifecycle;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

export function draftFingerprint(state: MenuReviewState) {
  return JSON.stringify(canonicalize(state));
}

class DraftManager {
  private snapshots = new Map<string, DraftSnapshot>();

  hydrate(id: string, state: MenuReviewState, revision: number, lifecycle: DraftLifecycle = "Synced") {
    const snapshot = { state, revision, fingerprint: draftFingerprint(state), lifecycle };
    this.snapshots.set(id, snapshot);
    return snapshot;
  }

  edit(id: string, state: MenuReviewState) {
    const current = this.snapshots.get(id);
    const snapshot = {
      state,
      revision: current?.revision ?? 0,
      fingerprint: current?.fingerprint ?? "",
      lifecycle: "Editing" as const,
    };
    this.snapshots.set(id, snapshot);
    return snapshot;
  }

  synced(id: string, state: MenuReviewState, revision: number) {
    return this.hydrate(id, state, revision, "Synced");
  }

  isChanged(id: string, state: MenuReviewState) {
    return this.snapshots.get(id)?.fingerprint !== draftFingerprint(state);
  }

  get(id: string) {
    return this.snapshots.get(id) ?? null;
  }

  clear(id: string) {
    this.snapshots.delete(id);
  }
}

export const draftManager = new DraftManager();

export function saveStateLabel(status: "saved" | "dirty" | "saving" | "error", offline = false): DraftLifecycle {
  if (status === "saving") return offline ? "Saving..." : "Syncing...";
  if (status === "dirty" || status === "error") return "Editing";
  return offline ? "Saved" : "Synced";
}

export function workflowErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message) return fallback;
  if (/failed to fetch|network|load failed/i.test(message)) return "We couldn't reach ServeFlow. Your draft is safe; check your connection and try again.";
  if (/jwt|authentication required|not authenticated/i.test(message)) return "Your session expired. Sign in again to continue.";
  if (/another session|newer review studio revision/i.test(message)) return "Your menu was updated elsewhere. Reload to review the latest changes.";
  if (/non-2xx|edge function/i.test(message)) return fallback;
  return message;
}
