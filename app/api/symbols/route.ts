import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { SYMBOL_RATE_LIMITS } from "@/lib/symbol-rate-policy";
import { UI_SYMBOL_LIMITS } from "@/lib/dhan-api-limits";
import {
  listSections,
  querySymbols,
  type SectionId
} from "@/services/symbols/symbol-registry";

export const runtime = "nodejs";

/**
 * GET /api/symbols
 *   ?section=dashboard|bot-universe|scanner|charts|watchlist|futures|options|commodity|currency|etf|all
 *   ?segment=NSE_EQ|BSE_EQ|...   (optional intra-section filter)
 *   ?q=tata                       (optional free-text search)
 *   ?limit=50&offset=0            (pagination)
 *
 * The registry guarantees India-only — there is no path that returns a
 * non-Indian symbol from this endpoint.
 *
 * Without query params, returns the section metadata catalogue so the UI
 * can render a section picker (sidebar / tabs) without a second call.
 */

const SECTION_IDS = [
  "all",
  "dashboard",
  "bot-universe",
  "scanner",
  "charts",
  "watchlist",
  "futures",
  "options",
  "commodity",
  "currency",
  "etf"
] as const;

const querySchema = z.object({
  section: z.enum(SECTION_IDS).optional(),
  segment: z.string().trim().min(1).max(20).optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().positive().max(UI_SYMBOL_LIMITS.registryPageSize).optional(),
  offset: z.coerce.number().int().nonnegative().optional()
});

const SYMBOL_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=60, stale-while-revalidate=300"
};

export async function GET(request: NextRequest) {
  try {
    const requestLimit = await rateLimit(request, "symbols:registry", SYMBOL_RATE_LIMITS.registry);
    if (!requestLimit.allowed) {
      return fail("RATE_LIMITED", "Too many symbol registry requests.", 429);
    }

    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      section: url.searchParams.get("section") ?? undefined,
      segment: url.searchParams.get("segment") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined
    });
    if (!parsed.success) {
      return fail("SYMBOLS_VALIDATION", "Invalid symbol query.", 422, parsed.error.flatten());
    }
    const { section, segment, q, limit, offset } = parsed.data;

    // Catalogue mode — no params at all means "tell me about the sections".
    if (!section && !segment && !q && limit === undefined && offset === undefined) {
      return ok({
        sections: listSections(),
        india_only: true,
        usage: "GET /api/symbols?section=<id>&segment=<NSE_EQ|...>&q=<text>&limit=&offset="
      }, {
        headers: SYMBOL_CACHE_HEADERS
      });
    }

    const result = await querySymbols({
      section: (section as SectionId | undefined) ?? "all",
      segment,
      query: q,
      limit,
      offset
    });
    return ok({
      india_only: true,
      section: section ?? "all",
      ...result
    }, {
      headers: SYMBOL_CACHE_HEADERS
    });
  } catch (error) {
    return fail(
      "SYMBOLS_QUERY_FAILED",
      error instanceof Error ? error.message : "Symbol query failed.",
      500
    );
  }
}
