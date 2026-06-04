/**
 * Redis-backed sliding-window rate limiter for authentication endpoints.
 *
 * This is intentionally separate from lib/rate-limit.ts, which is a no-op
 * because market data streaming has an unlimited DhanHQ subscription.
 * Auth endpoints (sign-in, sign-up) MUST be rate limited to prevent
 * credential stuffing and account enumeration attacks.
 *
 * Uses a token-bucket approach stored in Redis with atomic INCR + EXPIRE.
 * Falls back to an in-memory store if Redis is unavailable.
 */

import type { NextRequest } from "next/server";
import { redis } from "@/lib/redis";
import { logger } from "@/lib/logger";

type AuthRateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetInSeconds: number;
};

// In-memory fallback when Redis is unavailable
const memoryStore = new Map<string, { count: number; expiresAt: number }>();
const MEMORY_STORE_MAX = 5_000;

function getClientKey(req: NextRequest, name: string): string {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  return `auth_rl:${name}:${ip}`;
}

function memoryRateLimit(key: string, limit: number, windowSec: number): AuthRateLimitResult {
  const now = Date.now();
  const entry = memoryStore.get(key);

  if (!entry || entry.expiresAt <= now) {
    if (memoryStore.size >= MEMORY_STORE_MAX) {
      // Evict expired entries
      for (const [k, v] of memoryStore) {
        if (v.expiresAt <= now) memoryStore.delete(k);
      }
    }
    memoryStore.set(key, { count: 1, expiresAt: now + windowSec * 1000 });
    return { allowed: true, remaining: limit - 1, resetInSeconds: windowSec };
  }

  entry.count += 1;
  const resetInSeconds = Math.ceil((entry.expiresAt - now) / 1000);
  const remaining = Math.max(0, limit - entry.count);
  return { allowed: entry.count <= limit, remaining, resetInSeconds };
}

/**
 * Rate-limits an auth request by IP address using Redis.
 * Falls back to in-memory limiting if Redis is unavailable.
 *
 * @param req - The incoming request (used to extract client IP)
 * @param name - A unique name for this rate limit bucket (e.g. "sign-in")
 * @param limit - Maximum requests allowed in the window
 * @param windowSec - Window duration in seconds (default: 60)
 */
export async function authRateLimit(
  req: NextRequest,
  name: string,
  limit: number,
  windowSec = 60
): Promise<AuthRateLimitResult> {
  if (process.env.NODE_ENV !== "production") {
    return { allowed: true, remaining: limit, resetInSeconds: 0 };
  }

  const key = getClientKey(req, name);

  try {
    const pipe = redis.pipeline();
    pipe.incr(key);
    pipe.ttl(key);
    const [[, count], [, ttl]] = (await pipe.exec()) as [[null, number], [null, number]];

    // Set expiry only on the first request in a window
    if (count === 1) {
      await redis.expire(key, windowSec);
    }

    const resetInSeconds = ttl > 0 ? ttl : windowSec;
    const remaining = Math.max(0, limit - count);
    return { allowed: count <= limit, remaining, resetInSeconds };
  } catch {
    logger.warn("Auth rate limit: Redis unavailable, falling back to in-memory", { key });
    return memoryRateLimit(key, limit, windowSec);
  }
}
