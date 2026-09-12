export type OwnerRetainedResource =
  | "table-stats"
  | "finance-period"
  | "menu-uploads";

export type OwnerRetainedScope = {
  userId: string;
  restaurantId: string;
};

type RetainedEntry<T> = {
  value?: T;
  updatedAt: number;
  expiresAt: number;
  pending?: Promise<T>;
};

export type OwnerRetainedSnapshot<T> = {
  value: T;
  updatedAt: number;
  isStale: boolean;
};

export const OWNER_RETAINED_POLICY = {
  tableStats: { freshForMs: 10_000, retainForMs: 120_000 },
  financePeriod: { freshForMs: 10_000, retainForMs: 120_000 },
  menuUploads: { freshForMs: 30_000, retainForMs: 300_000 },
} as const;

const retainedResources = new Map<string, RetainedEntry<unknown>>();
let activeScopeKey: string | null = null;
let retainedGeneration = 0;

export class OwnerRetainedScopeChangedError extends Error {
  constructor() {
    super("Owner retained-resource scope changed.");
  }
}

export class OwnerRetainedAccessError extends Error {
  constructor() {
    super("Owner access is unavailable.");
  }
}

export function assertOwnerRetainedRequestAccess(status: number) {
  if (status === 401 || status === 403) {
    clearOwnerRetainedResources();
    throw new OwnerRetainedAccessError();
  }
}

function scopeKey(scope: OwnerRetainedScope) {
  return JSON.stringify([scope.userId, scope.restaurantId]);
}

export function ownerRetainedResourceKey(
  scope: OwnerRetainedScope,
  resource: OwnerRetainedResource,
  dimensions = "",
) {
  return JSON.stringify([
    scope.userId,
    scope.restaurantId,
    resource,
    dimensions,
  ]);
}

export function activateOwnerRetainedScope(scope: OwnerRetainedScope) {
  const nextScopeKey = scopeKey(scope);
  if (activeScopeKey === nextScopeKey) {
    for (const [key, entry] of retainedResources) {
      if (entry.value !== undefined && Date.now() > entry.expiresAt) {
        if (entry.pending)
          retainedResources.set(key, {
            updatedAt: 0,
            expiresAt: 0,
            pending: entry.pending,
          });
        else retainedResources.delete(key);
      }
    }
    return;
  }
  retainedResources.clear();
  retainedGeneration += 1;
  activeScopeKey = nextScopeKey;
}

export function clearOwnerRetainedResources() {
  retainedResources.clear();
  retainedGeneration += 1;
  activeScopeKey = null;
}

export function readOwnerRetainedResource<T>({
  scope,
  resource,
  dimensions = "",
  freshForMs,
  retainForMs,
  now = Date.now(),
}: {
  scope: OwnerRetainedScope;
  resource: OwnerRetainedResource;
  dimensions?: string;
  freshForMs: number;
  retainForMs: number;
  now?: number;
}): OwnerRetainedSnapshot<T> | null {
  if (activeScopeKey !== scopeKey(scope)) return null;
  const key = ownerRetainedResourceKey(scope, resource, dimensions);
  const entry = retainedResources.get(key) as RetainedEntry<T> | undefined;
  if (entry?.value === undefined) return null;
  const age = Math.max(0, now - entry.updatedAt);
  if (age > retainForMs || now > entry.expiresAt) {
    if (entry.pending) {
      retainedResources.set(key, {
        updatedAt: 0,
        expiresAt: 0,
        pending: entry.pending,
      });
    } else retainedResources.delete(key);
    return null;
  }
  return {
    value: entry.value,
    updatedAt: entry.updatedAt,
    isStale: age > freshForMs,
  };
}

export function revalidateOwnerRetainedResource<T>({
  scope,
  resource,
  dimensions = "",
  loader,
  afterPending = false,
}: {
  scope: OwnerRetainedScope;
  resource: OwnerRetainedResource;
  dimensions?: string;
  loader: () => Promise<T>;
  afterPending?: boolean;
}): Promise<T> {
  if (activeScopeKey !== scopeKey(scope)) {
    return Promise.reject(new OwnerRetainedScopeChangedError());
  }

  const key = ownerRetainedResourceKey(scope, resource, dimensions);
  const current = retainedResources.get(key) as RetainedEntry<T> | undefined;
  if (current?.pending) {
    if (!afterPending) return current.pending;
    const waitingGeneration = retainedGeneration;
    return current.pending.catch(() => undefined).then(() => {
      if (
        waitingGeneration !== retainedGeneration ||
        activeScopeKey !== scopeKey(scope)
      )
        throw new OwnerRetainedScopeChangedError();
      return revalidateOwnerRetainedResource({
        scope,
        resource,
        dimensions,
        loader,
      });
    });
  }

  const generation = retainedGeneration;
  const expectedScopeKey = activeScopeKey;
  const pending = Promise.resolve()
    .then(loader)
    .then((value) => {
      if (
        generation !== retainedGeneration ||
        activeScopeKey !== expectedScopeKey
      )
        throw new OwnerRetainedScopeChangedError();
      const retainForMs =
        resource === "menu-uploads"
          ? OWNER_RETAINED_POLICY.menuUploads.retainForMs
          : resource === "table-stats"
            ? OWNER_RETAINED_POLICY.tableStats.retainForMs
            : OWNER_RETAINED_POLICY.financePeriod.retainForMs;
      retainedResources.set(key, {
        value,
        updatedAt: Date.now(),
        expiresAt: Date.now() + retainForMs,
      });
      return value;
    })
    .catch((error) => {
      if (
        generation === retainedGeneration &&
        activeScopeKey === expectedScopeKey
      ) {
        if (current?.value !== undefined) retainedResources.set(key, current);
        else retainedResources.delete(key);
      }
      throw error;
    });

  retainedResources.set(key, {
    value: current?.value,
    updatedAt: current?.updatedAt ?? 0,
    expiresAt: current?.expiresAt ?? 0,
    pending,
  });
  return pending;
}
