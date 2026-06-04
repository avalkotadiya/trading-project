import { ok, fail } from "@/lib/api-response";
import { getAuthenticatedUser, UnauthorizedError } from "@/lib/auth";
import { getAIHealth } from "@/lib/ai";

/**
 * GET /api/ai/status
 *
 * Reports the multi-provider AI gateway state: which provider layers are
 * configured, the failover order, and any provider currently in cooldown.
 * No API keys are exposed. Auth-gated, consistent with the other AI routes.
 */
export async function GET() {
  try {
    await getAuthenticatedUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) return fail("UNAUTHORIZED", error.message, 401);
    return fail("UNAUTHORIZED", "Authentication required.", 401);
  }

  const health = getAIHealth();
  const active = health.providers.filter((p) => p.configured && p.inChain);

  return ok({
    ...health,
    activeLayers: active.length,
    ready: active.length > 0
  });
}
