type CacheEntry<T> = {
  value?: T;
  updatedAt: number;
  pending?: Promise<T>;
};

const managerDataCache = new Map<string, CacheEntry<unknown>>();
let cacheGeneration = 0;
const MANAGER_DATA_TIMEOUT_MS = 15_000;

export function withManagerDataTimeout<T>(request: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => reject(new Error("Manager data request timed out.")), MANAGER_DATA_TIMEOUT_MS);
    request.then(resolve, reject).finally(() => globalThis.clearTimeout(timeoutId));
  });
}

function cacheKey(restaurantId: string, resource: string) {
  return `${restaurantId}:${resource}`;
}

export async function loadManagerCachedData<T>({
  restaurantId,
  resource,
  maxAgeMs,
  loader,
  force = false,
}: {
  restaurantId: string;
  resource: string;
  maxAgeMs: number;
  loader: () => Promise<T>;
  force?: boolean;
}): Promise<T> {
  const key = cacheKey(restaurantId, resource);
  const current = managerDataCache.get(key) as CacheEntry<T> | undefined;
  if (!force && current?.value !== undefined && Date.now() - current.updatedAt < maxAgeMs) {
    return current.value;
  }
  if (current?.pending) return current.pending;

  const generation = cacheGeneration;
  const pending = withManagerDataTimeout(loader()).then((value) => {
    if (generation === cacheGeneration) managerDataCache.set(key, { value, updatedAt: Date.now() });
    return value;
  }).catch((error) => {
    if (generation === cacheGeneration) {
      if (current?.value !== undefined) managerDataCache.set(key, current);
      else managerDataCache.delete(key);
    }
    throw error;
  });
  managerDataCache.set(key, { value: current?.value, updatedAt: current?.updatedAt ?? 0, pending });
  return pending;
}

export function retainManagerTenantCache(restaurantId: string) {
  let invalidated = false;
  for (const key of managerDataCache.keys()) {
    if (!key.startsWith(`${restaurantId}:`)) {
      managerDataCache.delete(key);
      invalidated = true;
    }
  }
  if (invalidated) cacheGeneration += 1;
}

export function clearManagerDataCache() {
  managerDataCache.clear();
  cacheGeneration += 1;
}
