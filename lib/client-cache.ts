type CacheEntry<T> = { value: T; storedAt: number };

const memory = new Map<string, CacheEntry<unknown>>();
const CLIENT_CACHE_MS = 5 * 60 * 1000;

export function readClientCache<T>(key: string) {
  const entry = memory.get(key) as CacheEntry<T> | undefined;
  if (!entry || Date.now() - entry.storedAt > CLIENT_CACHE_MS) return null;
  return entry.value;
}

export function writeClientCache<T>(key: string, value: T) {
  memory.set(key, { value, storedAt: Date.now() });
}

export function invalidateClientCache(prefix: string) {
  for (const key of memory.keys()) if (key.startsWith(prefix)) memory.delete(key);
}
