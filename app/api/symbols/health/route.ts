import { fail, ok } from "@/lib/api-response";
import { getRegistryHealth, invalidateRegistryCache } from "@/services/symbols/symbol-registry";
import { getMasterFreshness } from "@/services/dhan/dhanInstruments";

export const runtime = "nodejs";

/**
 * GET  /api/symbols/health
 *   Returns: total symbols, per-section counts, per-segment counts, rejection
 *   breakdown (expired, bad_series, sme, ...), and freshness of the underlying
 *   Dhan scrip-master fetch.
 *
 * POST /api/symbols/health  (action=refresh)
 *   Force the registry cache to expire so the next read rebuilds from Dhan.
 *   Useful when the operator knows the master changed (e.g. new listings
 *   that day) and doesn't want to wait for the 6h TTL.
 */

export async function GET() {
  try {
    const health = await getRegistryHealth();
    const masterFreshness = getMasterFreshness();
    return ok({
      ...health,
      masterFetchedAt: masterFreshness.fetchedAt
        ? new Date(masterFreshness.fetchedAt).toISOString()
        : null,
      masterRowCount: masterFreshness.rowCount
    });
  } catch (error) {
    return fail(
      "REGISTRY_HEALTH_FAILED",
      error instanceof Error ? error.message : "Registry health check failed.",
      500
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { action?: string };
    if (body.action !== "refresh") {
      return fail("REGISTRY_REFRESH_INVALID", 'Expected body { "action": "refresh" }.', 400);
    }
    await invalidateRegistryCache();
    return ok({ refreshed: true, note: "Next /api/symbols call will rebuild from Dhan master." });
  } catch (error) {
    return fail(
      "REGISTRY_REFRESH_FAILED",
      error instanceof Error ? error.message : "Registry refresh failed.",
      500
    );
  }
}
