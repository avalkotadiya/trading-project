import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

export const redis =
  globalForRedis.redis ??
  new Redis(redisUrl, {
    connectTimeout: 1200,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    commandTimeout: 1200,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 500);
      return delay;
    }
  });

redis.on("error", () => {
  // Redis-backed features gracefully fail at their call sites when Redis is unavailable.
});

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}
