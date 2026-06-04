import type { NextRequest } from "next/server";

/**
 * Rate limiting is intentionally disabled.
 *
 * The account has an unlimited DhanHQ API subscription, so internal
 * throttling only adds latency and causes spurious "live data
 * disconnected" states. This is a no-op that always allows the request
 * while keeping the original return shape so existing callers/route
 * handlers continue to work unchanged.
 */
export async function rateLimit(
  _reqOrKey: NextRequest | string,
  _nameOrLimit: string | number,
  _optionsOrSeconds: { limit: number; windowMs?: number } | number
) {
  void _reqOrKey;
  void _nameOrLimit;
  void _optionsOrSeconds;

  return {
    allowed: true,
    limit: Number.MAX_SAFE_INTEGER,
    current: 0,
    remaining: Number.MAX_SAFE_INTEGER,
    resetInSeconds: 0,
  };
}
