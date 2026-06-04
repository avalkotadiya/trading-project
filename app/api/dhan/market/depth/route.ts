/**
 * GET  /api/dhan/market/depth?segment=NSE_EQ&securityId=1333
 * POST /api/dhan/market/depth   body: { instruments: [{ExchangeSegment, SecurityId}…] }
 *
 * Returns 20-level bid/ask market depth from Dhan's /marketfeed/depth20 endpoint.
 * Supports single-instrument GET requests and bulk POST for up to 100 instruments.
 *
 * Full subscription plan features used:
 *   ✅  20 Market Depth  (depth20 endpoint)
 *   ✅  Full Market Depth (5-level via quote, or 20-level via depth20)
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { dhanMarketDepthService } from "@/services/dhan/dhanMarketDepth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bulkSchema = z.object({
  instruments: z
    .array(
      z.object({
        ExchangeSegment: z.string().min(1),
        SecurityId: z.string().min(1)
      })
    )
    .min(1)
    .max(100)
});

// GET  /api/dhan/market/depth?segment=NSE_EQ&securityId=1333
export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, "dhan:market:depth:get", { limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Too many depth requests.", 429);

  const segment = request.nextUrl.searchParams.get("segment") ?? "";
  const securityId = request.nextUrl.searchParams.get("securityId") ?? "";

  if (!segment || !securityId) {
    return fail(
      "MISSING_PARAMS",
      "Both 'segment' (e.g. NSE_EQ) and 'securityId' are required.",
      400
    );
  }

  try {
    const depth = await dhanMarketDepthService.getDepthForOne(segment, securityId);
    if (!depth) {
      return fail("DEPTH_NOT_FOUND", `No depth data returned for ${segment}:${securityId}.`, 404);
    }
    return ok({ depth });
  } catch (error) {
    return fail(
      "DEPTH_FETCH_FAILED",
      error instanceof Error ? error.message : "Failed to fetch market depth.",
      500
    );
  }
}

// POST /api/dhan/market/depth   body: { instruments: [{ExchangeSegment, SecurityId}…] }
export async function POST(request: NextRequest) {
  const limit = await rateLimit(request, "dhan:market:depth:post", { limit: 30, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Too many bulk depth requests.", 429);

  const parsed = bulkSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "Invalid request body.", 422, parsed.error.flatten());
  }

  try {
    const depthMap = await dhanMarketDepthService.getDepth20(parsed.data.instruments);
    const depths = Array.from(depthMap.values());
    return ok({ depths, count: depths.length });
  } catch (error) {
    return fail(
      "DEPTH_FETCH_FAILED",
      error instanceof Error ? error.message : "Failed to fetch market depth.",
      500
    );
  }
}
