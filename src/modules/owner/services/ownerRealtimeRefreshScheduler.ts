import type { OwnerRetainedScope } from "./ownerRetainedResources";

export type OwnerRealtimeRefreshGroup =
  | "financial"
  | "table-metadata"
  | "table-stats"
  | "menu";

type SchedulerOptions = {
  scope: OwnerRetainedScope;
  refresh: Record<OwnerRealtimeRefreshGroup, () => Promise<void> | void>;
  delayMs?: number;
};

/**
 * Coalesces a short burst of tenant-local realtime intent.  A group that is
 * dirtied while its authoritative read is running gets exactly one follow-up.
 */
export function createOwnerRealtimeRefreshScheduler({
  scope,
  refresh,
  delayMs = 80,
}: SchedulerOptions) {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const dirty = new Set<OwnerRealtimeRefreshGroup>();
  const running = new Set<OwnerRealtimeRefreshGroup>();

  const schedule = () => {
    if (disposed || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, delayMs);
  };

  const flush = () => {
    if (disposed) return;
    for (const group of [...dirty]) {
      if (running.has(group)) continue;
      dirty.delete(group);
      running.add(group);
      Promise.resolve(refresh[group]())
        .catch(() => {
          // The existing resource loader owns user-visible error state.
        })
        .finally(() => {
          running.delete(group);
          if (!disposed && dirty.has(group)) schedule();
        });
    }
  };

  return {
    scope,
    mark(group: OwnerRealtimeRefreshGroup) {
      if (disposed) return;
      dirty.add(group);
      schedule();
    },
    dispose() {
      disposed = true;
      dirty.clear();
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
