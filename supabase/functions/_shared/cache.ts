// Best-effort in-module cache for warm Edge Function instances.
// State only survives while the same isolate stays warm between invocations —
// a cold start (or a request landing on a different instance) always misses.
// Expiry is checked lazily on read rather than via setTimeout, since a
// frozen/paused isolate between invocations can't be relied on to run timers.

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.data as T;
}

export function cacheSet<T>(key: string, data: T, ttlMs: number): void {
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
}
