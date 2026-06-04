import type { NextRequest } from "next/server";

type RateLimitOptions = {
  limit: number;
  windowMs?: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();
const DEFAULT_WINDOW_MS = 60_000;
const SWEEP_THRESHOLD = 2_000;

function isRateLimitDisabled() {
  return process.env.RATE_LIMIT_DISABLED === "1" || process.env.DISABLE_RATE_LIMIT === "1";
}

function sweepExpired(now: number) {
  if (buckets.size < SWEEP_THRESHOLD) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function clientKey(reqOrKey: NextRequest | string) {
  if (typeof reqOrKey === "string") return reqOrKey;

  const forwarded = reqOrKey.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = reqOrKey.headers.get("x-real-ip")?.trim();
  const session = reqOrKey.cookies.get("session")?.value;
  return forwarded || realIp || session || "anonymous";
}

export async function rateLimit(
  reqOrKey: NextRequest | string,
  nameOrLimit: string | number,
  optionsOrSeconds: RateLimitOptions | number
) {
  const options: RateLimitOptions =
    typeof optionsOrSeconds === "number"
      ? { limit: typeof nameOrLimit === "number" ? nameOrLimit : 60, windowMs: optionsOrSeconds * 1000 }
      : optionsOrSeconds;

  const limit = Math.max(1, options.limit);
  const windowMs = Math.max(1_000, options.windowMs ?? DEFAULT_WINDOW_MS);

  if (isRateLimitDisabled()) {
    return {
      allowed: true,
      limit,
      current: 0,
      remaining: limit,
      resetInSeconds: 0
    };
  }

  const now = Date.now();
  sweepExpired(now);

  const namespace = typeof nameOrLimit === "string" ? nameOrLimit : "default";
  const key = `${namespace}:${clientKey(reqOrKey)}`;
  const existing = buckets.get(key);
  const bucket = existing && existing.resetAt > now
    ? existing
    : { count: 0, resetAt: now + windowMs };

  bucket.count += 1;
  buckets.set(key, bucket);

  const remaining = Math.max(0, limit - bucket.count);

  return {
    allowed: bucket.count <= limit,
    limit,
    current: bucket.count,
    remaining,
    resetInSeconds: Math.ceil((bucket.resetAt - now) / 1000)
  };
}
