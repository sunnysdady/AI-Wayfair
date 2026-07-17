type CacheEntry<T> = { value: T; storedAt: number };

const memory = new Map<string, CacheEntry<unknown>>();
const CLIENT_CACHE_MS = 60 * 60 * 1000;
export const CLIENT_CACHE_RETENTION_MS = 24 * 60 * 60 * 1000;
const STORAGE_PREFIX = "wayfair-ai-cache:";

function browserStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readClientCache<T>(key: string, maxAgeMs = CLIENT_CACHE_MS) {
  let entry = memory.get(key) as CacheEntry<T> | undefined;
  const storage = browserStorage();
  if (!entry && storage) {
    try {
      const saved = storage.getItem(`${STORAGE_PREFIX}${key}`);
      entry = saved ? JSON.parse(saved) as CacheEntry<T> : undefined;
      if (entry) memory.set(key, entry);
    } catch {
      storage.removeItem(`${STORAGE_PREFIX}${key}`);
    }
  }
  if (!entry) return null;
  const age = Date.now() - entry.storedAt;
  if (age > CLIENT_CACHE_RETENTION_MS) {
    memory.delete(key);
    storage?.removeItem(`${STORAGE_PREFIX}${key}`);
    return null;
  }
  if (age > maxAgeMs) return null;
  return entry.value;
}

export function writeClientCache<T>(key: string, value: T) {
  const entry = { value, storedAt: Date.now() };
  memory.set(key, entry);
  try {
    browserStorage()?.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(entry));
  } catch {
    // D1 remains the durable source of truth when browser storage is unavailable.
  }
}

export function invalidateClientCache(prefix: string) {
  for (const key of memory.keys()) if (key.startsWith(prefix)) memory.delete(key);
  const storage = browserStorage();
  if (!storage) return;
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key?.startsWith(`${STORAGE_PREFIX}${prefix}`)) storage.removeItem(key);
  }
}
