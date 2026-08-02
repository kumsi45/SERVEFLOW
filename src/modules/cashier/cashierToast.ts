export type CashierToastType = "success" | "information" | "warning" | "error";

export const CASHIER_TOAST_DURATIONS: Record<
  CashierToastType,
  number | null
> = {
  success: 4_000,
  information: 5_000,
  warning: 7_000,
  error: null,
};

export const CASHIER_TOAST_EXIT_DURATION = 160;
export const CASHIER_TOAST_MAX_VISIBLE = 3;

export type CashierToastInput = {
  id?: string;
  dedupeKey?: string;
  type: CashierToastType;
  title: string;
  description?: string;
  durationMs?: number | null;
};

export type CashierToast = Required<
  Pick<CashierToastInput, "id" | "dedupeKey" | "type" | "title">
> & {
  description?: string;
  durationMs: number | null;
  remainingMs: number | null;
  paused: boolean;
  exiting: boolean;
};

type TimerHandle = ReturnType<typeof setTimeout>;
type TimerState = { handle: TimerHandle; startedAt: number };
type PauseReason = "hover" | "focus";
type InternalToast = CashierToast & { pauseReasons: Set<PauseReason> };
type ToastSnapshot = { visible: CashierToast[]; queuedCount: number };

export class CashierToastController {
  private visible: InternalToast[] = [];
  private queued: InternalToast[] = [];
  private listeners = new Set<(snapshot: ToastSnapshot) => void>();
  private displayTimers = new Map<string, TimerState>();
  private exitTimers = new Map<string, TimerHandle>();
  private recentDedupe = new Map<string, number>();
  private sequence = 0;

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly duplicateWindowMs = 2_000,
  ) {}

  getSnapshot(): ToastSnapshot {
    return {
      visible: this.visible.map(({ pauseReasons: _pauseReasons, ...toast }) => ({
        ...toast,
      })),
      queuedCount: this.queued.length,
    };
  }

  subscribe(listener: (snapshot: ToastSnapshot) => void) {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  push(input: CashierToastInput) {
    const currentTime = this.now();
    const dedupeKey =
      input.dedupeKey ??
      `${input.type}:${input.title}:${input.description ?? ""}`;
    const lastSeen = this.recentDedupe.get(dedupeKey);
    const alreadyQueued = [...this.visible, ...this.queued].some(
      (toast) => toast.dedupeKey === dedupeKey && !toast.exiting,
    );
    if (
      alreadyQueued ||
      (lastSeen !== undefined && currentTime - lastSeen < this.duplicateWindowMs)
    ) {
      return null;
    }

    this.recentDedupe.set(dedupeKey, currentTime);
    if (this.recentDedupe.size > 100) {
      const oldest = this.recentDedupe.keys().next().value;
      if (oldest) this.recentDedupe.delete(oldest);
    }

    const durationMs =
      input.durationMs === undefined
        ? CASHIER_TOAST_DURATIONS[input.type]
        : input.durationMs;
    const toast: InternalToast = {
      id: input.id ?? `cashier-toast-${currentTime}-${this.sequence++}`,
      dedupeKey,
      type: input.type,
      title: input.title,
      description: input.description,
      durationMs,
      remainingMs: durationMs,
      paused: false,
      exiting: false,
      pauseReasons: new Set(),
    };

    if (this.visible.length < CASHIER_TOAST_MAX_VISIBLE) {
      this.visible.unshift(toast);
      this.startDisplayTimer(toast);
    } else {
      this.queued.push(toast);
    }
    this.emit();
    return toast.id;
  }

  pause(id: string, reason: PauseReason) {
    const toast = this.visible.find((candidate) => candidate.id === id);
    if (!toast || toast.exiting || toast.pauseReasons.has(reason)) return;
    toast.pauseReasons.add(reason);
    toast.paused = true;

    const timer = this.displayTimers.get(id);
    if (timer && toast.remainingMs !== null) {
      clearTimeout(timer.handle);
      this.displayTimers.delete(id);
      toast.remainingMs = Math.max(
        0,
        toast.remainingMs - (this.now() - timer.startedAt),
      );
    }
    this.emit();
  }

  resume(id: string, reason: PauseReason) {
    const toast = this.visible.find((candidate) => candidate.id === id);
    if (!toast || toast.exiting || !toast.pauseReasons.has(reason)) return;
    toast.pauseReasons.delete(reason);
    toast.paused = toast.pauseReasons.size > 0;
    if (!toast.paused) this.startDisplayTimer(toast);
    this.emit();
  }

  dismiss(id: string) {
    const queuedIndex = this.queued.findIndex((toast) => toast.id === id);
    if (queuedIndex >= 0) {
      this.queued.splice(queuedIndex, 1);
      this.emit();
      return;
    }

    const toast = this.visible.find((candidate) => candidate.id === id);
    if (!toast || toast.exiting) return;
    toast.exiting = true;
    this.clearDisplayTimer(id);
    this.emit();
    const handle = setTimeout(
      () => this.finishDismiss(id),
      CASHIER_TOAST_EXIT_DURATION,
    );
    this.exitTimers.set(id, handle);
  }

  destroy() {
    for (const timer of this.displayTimers.values()) clearTimeout(timer.handle);
    for (const timer of this.exitTimers.values()) clearTimeout(timer);
    this.displayTimers.clear();
    this.exitTimers.clear();
    this.listeners.clear();
  }

  private startDisplayTimer(toast: InternalToast) {
    if (
      toast.remainingMs === null ||
      toast.remainingMs <= 0 ||
      toast.paused ||
      toast.exiting ||
      this.displayTimers.has(toast.id)
    ) {
      return;
    }
    const startedAt = this.now();
    const handle = setTimeout(() => {
      this.displayTimers.delete(toast.id);
      this.dismiss(toast.id);
    }, toast.remainingMs);
    this.displayTimers.set(toast.id, { handle, startedAt });
  }

  private clearDisplayTimer(id: string) {
    const timer = this.displayTimers.get(id);
    if (!timer) return;
    clearTimeout(timer.handle);
    this.displayTimers.delete(id);
  }

  private finishDismiss(id: string) {
    this.exitTimers.delete(id);
    const index = this.visible.findIndex((toast) => toast.id === id);
    if (index >= 0) this.visible.splice(index, 1);

    const next = this.queued.shift();
    if (next) {
      this.visible.unshift(next);
      this.startDisplayTimer(next);
    }
    this.emit();
  }

  private emit() {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
