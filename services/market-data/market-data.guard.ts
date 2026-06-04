import { fail } from "@/lib/api-response";
import { getAuthenticatedUser, UnauthorizedError } from "@/lib/auth";
import { DhanError } from "@/services/dhan/dhanClient";
import { shouldRequireMarketDataAuth } from "@/services/market-data/market-data.config";
import { MarketDataError } from "@/services/market-data/market-data.types";

export async function requireMarketDataAccess() {
  if (!shouldRequireMarketDataAuth()) {
    return null;
  }

  try {
    await getAuthenticatedUser();
    return null;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return fail("UNAUTHORIZED", "Authentication is required for licensed market data.", 401);
    }

    return fail("AUTH_CHECK_FAILED", "Unable to verify market data access.", 500);
  }
}

export function marketDataErrorResponse(error: unknown) {
  if (error instanceof MarketDataError) {
    return fail(error.code, error.message, error.status);
  }

  if (error instanceof DhanError) {
    const detail = extractDhanErrorMessage(error.details);
    return fail(error.code, detail ?? error.message, error.status);
  }

  return fail("MARKET_DATA_FAILED", "Unable to process market data request.", 500);
}

function extractDhanErrorMessage(details: unknown) {
  if (!details || typeof details !== "object") return null;
  const data = (details as { data?: unknown }).data;
  if (data && typeof data === "object") {
    const messages = Object.entries(data as Record<string, unknown>)
      .map(([code, message]) => (typeof message === "string" ? `Dhan ${code}: ${message}` : null))
      .filter(Boolean);
    if (messages.length > 0) return messages.join("; ");
  }
  return null;
}
