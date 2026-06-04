/**
 * Cache layer — in-memory with optional Upstash Redis REST backend.
 *
 * Performance fix: cacheGetOrSet now uses a per-key in-flight promise map to
 * prevent cache stampedes (thundering herd). When a cache entry expires and
 * multiple concurrent requests arrive simultaneously, only ONE factory call is
 * made; all others await its result.
 */

type CacheEntry = {
  value: unknown;
  expiresAt: number;
};

const memoryCache = new Map<string, CacheEntry>();
// Tracks in-flight factory calls to prevent thundering herd on cache miss
const inFlight = new Map<string, Promise<unknown>>();

// Evict all expired entries. Called lazily when the map grows to avoid
// accumulating stale keys indefinitely when Redis is not configured.
const MEMORY_CACHE_SWEEP_THRESHOLD = 200;
function sweepMemoryCache() {
  const now = Date.now();
  for (const [key, entry] of memoryCache) {
    if (entry.expiresAt <= now) memoryCache.delete(key);
  }
}

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.REDIS_REST_TOKEN;

  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export function getCacheProviderName() {
  return getRedisConfig() ? "redis" : "memory";
}

export async function getCache<T>(key: string): Promise<T | null> {
  const redis = getRedisConfig();

  if (redis) {
    const response = await fetch(`${redis.url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${redis.token}` },
      cache: "no-store"
    }).catch(() => null);

    if (!response?.ok) {
      return null;
    }

    const payload = (await response.json()) as { result?: string | null };

    if (!payload.result) {
      return null;
    }

    try {
      return JSON.parse(payload.result) as T;
    } catch {
      return null;
    }
  }

  const entry = memoryCache.get(key);

  if (!entry || entry.expiresAt <= Date.now()) {
    memoryCache.delete(key);
    return null;
  }

  return entry.value as T;
}

export async function setCache<T>(key: string, value: T, ttlSeconds: number) {
  const redis = getRedisConfig();

  if (redis) {
    await fetch(redis.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redis.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(["SET", key, JSON.stringify(value), "EX", ttlSeconds]),
      cache: "no-store"
    }).catch(() => null);
    return;
  }

  if (memoryCache.size >= MEMORY_CACHE_SWEEP_THRESHOLD) sweepMemoryCache();
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000
  });
}

/**
 * Read-through cache with stampede (thundering herd) protection.
 *
 * If multiple callers concurrently miss the same key, only the first invocation
 * executes the factory. All subsequent callers subscribe to the same in-flight
 * Promise and receive the same resolved value, preventing N parallel DB/API
 * hits on a hot cache miss.
 */
export async function cacheGetOrSet<T>(
  key: string,
  ttlSeconds: number,
  factory: () => Promise<T> | T
): Promise<T> {
  const cached = await getCache<T>(key);
  if (cached !== null) return cached;

  // Check if a factory call is already in-flight for this key
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  // We are the first — kick off the factory and register the promise
  const promise = Promise.resolve(factory()).then(async (value) => {
    await setCache(key, value, ttlSeconds);
    inFlight.delete(key);
    return value;
  }).catch((error) => {
    inFlight.delete(key); // Release on failure so next request retries
    throw error;
  });

  inFlight.set(key, promise);
  return promise as Promise<T>;
}
