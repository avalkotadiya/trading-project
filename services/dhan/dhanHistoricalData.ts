/**
 * Dhan historical & intraday candle service.
 *
 * Dhan's published rate limits (https://dhanhq.co/docs/v2/rate-limit/) for
 * Data API endpoints (/charts/historical, /charts/intraday):
 *   - Per second:  5
 *   - Per minute:  100   ← THIS IS THE BINDING CONSTRAINT
 *   - Per hour:    1000
 *
 * The per-minute cap is the killer. 5 req/s sustained = 300/min, which trips
 * the 100/min limit after ~20 seconds. So the effective sustained rate is
 * 100/60 ≈ 1.66 req/s, not 5.
 *
 * Throttle architecture (this file is the single chokepoint for both endpoints):
 *
 *   1. Per-endpoint token bucket
 *        - Capacity 3 (burst), refill 1.5 tokens/s (sustained, well below the
 *          1.66/s implied by the 100/min ceiling).
 *
 *   2. Sliding-window per-minute quota
 *        - Tracks the timestamps of the last N requests; blocks new requests
 *          when N has reached MAX_PER_MINUTE within the trailing 60 s.
 *          Default 45/min so QuantEdge, chart views, and other Dhan calls
 *          have room to share the same broker account quota.
 *
 *   3. Bucket-managed 429 retry (DhanClient's internal retry disabled)
 *        - withBucket retries the request itself when 429 is observed, with
 *          a coordinated cooldown across ALL callers. DhanClient is invoked
 *          with `skipRetryOn429: true` so its exponential-backoff retries
 *          don't fire HTTP requests during our cooldown (the original cause
 *          of cascading 429s).
 *
 *   4. Result caching via cacheGetOrSet (with stampede protection)
 *        - Daily candles cached for DAILY_TTL_SECONDS (default 6 h).
 *        - Intraday candles cached for INTRADAY_TTL_SECONDS (default 180 s).
 *
 * NO YAHOO FALLBACK. Dhan is the single source of truth.
 */

import { DhanClient, DhanError } from "@/services/dhan/dhanClient";
import { resolveDhanAccessToken } from "@/services/dhan/dhanAuth";
import { cacheGetOrSet } from "@/lib/cache";
import { logger } from "@/lib/logger";
import type { Candle } from "@/types/ai-trading";
import { normalizeDhanChartRequest } from "@/services/dhan/dhanChartValidation";

export type DhanHistoricalRequest = {
  securityId: string;
  exchangeSegment?: string;
  instrument?: string;
  interval?: string;
  fromDate: string;
  toDate: string;
  /** F&O expiry code. Required by the Dhan v2 charts endpoints; 0 for equity/index. */
  expiryCode?: number;
  /** Whether to include open-interest series. Defaults to false; required by the API. */
  oi?: boolean;
};

// ─── Tuning knobs (all env-overridable) ────────────────────────────────────
const DAILY_REFILL_PER_SEC = Math.max(0.1, Number(process.env.DHAN_DAILY_RPS || "0.75"));
const INTRADAY_REFILL_PER_SEC = Math.max(0.1, Number(process.env.DHAN_INTRADAY_RPS || "0.75"));
const BUCKET_CAPACITY = Math.max(1, Number(process.env.DHAN_BUCKET_CAPACITY || "2"));
// Sliding 60 s window cap per endpoint. Dhan documented limit is 100/min;
// 45/min leaves room for QuantEdge, chart views, and other Dhan API calls.
const MAX_PER_MINUTE = Math.max(10, Number(process.env.DHAN_HIST_PER_MINUTE || "45"));
const ADAPTIVE_COOLDOWN_MS = Math.max(1_000, Number(process.env.DHAN_429_COOLDOWN_MS || "60000"));
const MAX_RETRIES_PER_REQUEST = Math.max(0, Number(process.env.DHAN_HIST_MAX_RETRIES || "3"));
const DAILY_TTL_SECONDS = Math.max(60, Number(process.env.DHAN_DAILY_TTL_SECONDS || String(6 * 60 * 60)));
const INTRADAY_TTL_SECONDS = Math.max(30, Number(process.env.DHAN_INTRADAY_TTL_SECONDS || "180"));

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

export function isDhanHistoricalRateLimitError(error: unknown): boolean {
  if (!(error instanceof DhanError)) return false;
  return error.status === 429 || error.dhanError?.category === "rate-limit";
}

// ─── Combined token bucket + sliding-window throttle ───────────────────────
class Throttle {
  private tokens: number;
  private lastRefillAt: number;
  private cooldownUntil = 0;
  /** Monotonic timestamps of granted requests in the last 60 s window. */
  private readonly window: number[] = [];

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    private readonly perMinute: number,
    private readonly label: string
  ) {
    this.tokens = capacity;
    this.lastRefillAt = Date.now();
  }

  /** Block until both bucket AND sliding-window allow a request, then consume. */
  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();

      // (1) Adaptive cooldown — set by noteRateLimit(). Blocks ALL callers until ms.
      if (now < this.cooldownUntil) {
        await sleep(this.cooldownUntil - now);
        continue;
      }

      // (2) Sliding 60-s window check — Dhan's 100/min quota.
      this.trimWindow(now);
      if (this.window.length >= this.perMinute) {
        const oldest = this.window[0];
        const waitMs = Math.max(50, oldest + 60_000 - now + 25);
        await sleep(waitMs);
        continue;
      }

      // (3) Token-bucket burst check.
      this.refillTokens(now);
      if (this.tokens < 1) {
        await sleep(Math.ceil(1000 / this.refillPerSec));
        continue;
      }

      this.tokens -= 1;
      this.window.push(now);
      return;
    }
  }

  /** Trigger an adaptive cooldown after a Dhan quota response. */
  noteRateLimit(ms: number) {
    const until = Date.now() + ms;
    if (until > this.cooldownUntil) this.cooldownUntil = until;
    // Drain the bucket and window so the next take() is freshly metered.
    this.tokens = 0;
    logger.warn(`[DhanThrottle] ${this.label} pausing ${ms}ms after Dhan rate limit`);
  }

  private refillTokens(now: number) {
    const elapsedSec = (now - this.lastRefillAt) / 1000;
    if (elapsedSec <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
    this.lastRefillAt = now;
  }

  private trimWindow(now: number) {
    const cutoff = now - 60_000;
    while (this.window.length > 0 && this.window[0] < cutoff) this.window.shift();
  }
}

const dailyThrottle = new Throttle(BUCKET_CAPACITY, DAILY_REFILL_PER_SEC, MAX_PER_MINUTE, "daily");
const intradayThrottle = new Throttle(BUCKET_CAPACITY, INTRADAY_REFILL_PER_SEC, MAX_PER_MINUTE, "intraday");

/**
 * Run `task` under the given throttle. On 429: pause the throttle, retry the
 * task itself (up to MAX_RETRIES_PER_REQUEST times). Retries go back through
 * the throttle so they observe the cooldown — DhanClient must be invoked with
 * skipRetryOn429: true to surrender retry control to us.
 *
 * Non-429 errors propagate immediately (404s for delisted/expired securities,
 * 500s, network errors etc. are not throttling problems).
 */
async function withThrottle<T>(throttle: Throttle, task: () => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    await throttle.take();
    try {
      return await task();
    } catch (error) {
      if (isDhanHistoricalRateLimitError(error)) {
        throttle.noteRateLimit(ADAPTIVE_COOLDOWN_MS);
        if (attempt < MAX_RETRIES_PER_REQUEST) {
          attempt += 1;
          continue;
        }
      }
      throw error;
    }
  }
}

// ─── Service ───────────────────────────────────────────────────────────────
export class DhanHistoricalDataService {
  private readonly client = new DhanClient(resolveDhanAccessToken);

  async intraday(input: DhanHistoricalRequest) {
    const request = normalizeDhanChartRequest({
      ...input,
      interval: input.interval ?? "5"
    });
    const key = `dhan:intraday:${request.exchangeSegment}:${request.instrument}:${request.securityId}:${request.interval}:${request.expiryCode}:${request.oi}:${request.fromDate}:${request.toDate}`;

    return cacheGetOrSet(key, INTRADAY_TTL_SECONDS, () =>
      withThrottle(intradayThrottle, () =>
        this.client.post(
          "/charts/intraday",
          {
            securityId: request.securityId,
            exchangeSegment: request.exchangeSegment,
            instrument: request.instrument,
            interval: request.interval,
            expiryCode: request.expiryCode,
            oi: request.oi,
            fromDate: request.fromDate,
            toDate: request.toDate
          },
          { skipRetryOn429: true }
        )
      )
    );
  }

  async daily(input: Omit<DhanHistoricalRequest, "interval">) {
    const request = normalizeDhanChartRequest(input);
    const key = `dhan:daily:${request.exchangeSegment}:${request.instrument}:${request.securityId}:${request.expiryCode}:${request.oi}:${request.fromDate}:${request.toDate}`;

    return cacheGetOrSet(key, DAILY_TTL_SECONDS, () =>
      withThrottle(dailyThrottle, () =>
        this.client.post(
          "/charts/historical",
          {
            securityId: request.securityId,
            exchangeSegment: request.exchangeSegment,
            instrument: request.instrument,
            expiryCode: request.expiryCode,
            oi: request.oi,
            fromDate: request.fromDate,
            toDate: request.toDate
          },
          { skipRetryOn429: true }
        )
      )
    );
  }

  normalizeCandles(response: unknown): Candle[] {
    if (!response || typeof response !== "object") return [];
    const data = response as {
      open?: unknown[];
      high?: unknown[];
      low?: unknown[];
      close?: unknown[];
      volume?: unknown[];
      timestamp?: unknown[];
      start_Time?: unknown[];
    };
    const timestamps = data.timestamp ?? data.start_Time ?? [];
    const length = Math.min(
      data.open?.length ?? 0,
      data.high?.length ?? 0,
      data.low?.length ?? 0,
      data.close?.length ?? 0,
      data.volume?.length ?? 0
    );

    return Array.from({ length }, (_, index) => {
      const rawTimestamp = timestamps[index];
      const timestamp =
        typeof rawTimestamp === "number"
          ? new Date(rawTimestamp * 1000).toISOString()
          : typeof rawTimestamp === "string"
            ? rawTimestamp
            : new Date().toISOString();

      return {
        timestamp,
        open: Number(data.open?.[index] ?? 0),
        high: Number(data.high?.[index] ?? 0),
        low: Number(data.low?.[index] ?? 0),
        close: Number(data.close?.[index] ?? 0),
        volume: Number(data.volume?.[index] ?? 0)
      };
    });
  }
}

export const dhanHistoricalDataService = new DhanHistoricalDataService();
