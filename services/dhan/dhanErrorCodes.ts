/**
 * Dhan v2 error code catalog.
 *
 * Source: https://github.com/dhan-oss/dhanhq-skills/blob/main/skills/dhanhq/references/error-codes.md
 *
 * Two families:
 *   - Trading API codes (DH-901 … DH-911)
 *   - Data API codes    (800, 804–814)
 *
 * Dhan returns both in the body as either { errorCode, errorType, errorMessage }
 * or wrapped as { status:"failure", remarks:{ error_code, error_type, error_message } }.
 *
 * Use `lookupDhanError(payload)` to normalize either shape into a single record
 * and `isRetryableDhanError(code)` to decide retry vs. fail-fast.
 */

export type DhanErrorCategory =
  | "authentication"
  | "access"
  | "account"
  | "rate-limit"
  | "input"
  | "order"
  | "data"
  | "server"
  | "network"
  | "infrastructure"
  | "other";

export type DhanErrorEntry = {
  code: string;
  httpStatusHint: number;
  category: DhanErrorCategory;
  message: string;
  /** Safe to auto-retry the same request after backoff. */
  retryable: boolean;
};

export const DHAN_ERROR_CATALOG: Record<string, DhanErrorEntry> = {
  // ─── Trading API (DH-9XX) ────────────────────────────────────────────────
  "DH-901": {
    code: "DH-901",
    httpStatusHint: 401,
    category: "authentication",
    message: "Client ID or access token is invalid or expired.",
    retryable: false
  },
  "DH-902": {
    code: "DH-902",
    httpStatusHint: 403,
    category: "access",
    message: "User does not have required Data API or Trading API access.",
    retryable: false
  },
  "DH-903": {
    code: "DH-903",
    httpStatusHint: 403,
    category: "account",
    message: "Account setup, segment activation, or related account requirement is pending.",
    retryable: false
  },
  "DH-904": {
    code: "DH-904",
    httpStatusHint: 429,
    category: "rate-limit",
    message: "Rate limit exceeded.",
    retryable: true
  },
  "DH-905": {
    code: "DH-905",
    httpStatusHint: 400,
    category: "input",
    message: "Missing or invalid request fields.",
    retryable: false
  },
  "DH-906": {
    code: "DH-906",
    httpStatusHint: 400,
    category: "order",
    message: "Order request cannot be processed.",
    retryable: false
  },
  "DH-907": {
    code: "DH-907",
    httpStatusHint: 400,
    category: "data",
    message: "Data unavailable or parameters invalid.",
    retryable: false
  },
  "DH-908": {
    code: "DH-908",
    httpStatusHint: 500,
    category: "server",
    message: "Server-side failure.",
    retryable: true
  },
  "DH-909": {
    code: "DH-909",
    httpStatusHint: 502,
    category: "network",
    message: "Backend communication failure.",
    retryable: true
  },
  "DH-910": {
    code: "DH-910",
    httpStatusHint: 500,
    category: "other",
    message: "Other failure reason.",
    retryable: false
  },
  "DH-911": {
    code: "DH-911",
    httpStatusHint: 403,
    category: "infrastructure",
    message: "Static IP invalid or not whitelisted.",
    retryable: false
  },
  // ─── Data API (numeric) ──────────────────────────────────────────────────
  "800": {
    code: "800",
    httpStatusHint: 500,
    category: "server",
    message: "Internal server error.",
    retryable: true
  },
  "804": {
    code: "804",
    httpStatusHint: 400,
    category: "input",
    message: "Requested number of instruments exceeds limit.",
    retryable: false
  },
  "805": {
    code: "805",
    httpStatusHint: 429,
    category: "rate-limit",
    message: "Too many requests or connections.",
    retryable: true
  },
  "806": {
    code: "806",
    httpStatusHint: 403,
    category: "access",
    message: "Data APIs not subscribed.",
    retryable: false
  },
  "807": {
    code: "807",
    httpStatusHint: 401,
    category: "authentication",
    message: "Access token is expired.",
    retryable: false
  },
  "808": {
    code: "808",
    httpStatusHint: 401,
    category: "authentication",
    message: "Authentication failed - client ID or access token invalid.",
    retryable: false
  },
  "809": {
    code: "809",
    httpStatusHint: 401,
    category: "authentication",
    message: "Access token is invalid.",
    retryable: false
  },
  "810": {
    code: "810",
    httpStatusHint: 401,
    category: "authentication",
    message: "Client ID is invalid.",
    retryable: false
  },
  "811": {
    code: "811",
    httpStatusHint: 400,
    category: "input",
    message: "Invalid expiry date.",
    retryable: false
  },
  "812": {
    code: "812",
    httpStatusHint: 400,
    category: "input",
    message: "Invalid date format.",
    retryable: false
  },
  "813": {
    code: "813",
    httpStatusHint: 400,
    category: "input",
    message: "Invalid security ID.",
    retryable: false
  },
  "814": {
    code: "814",
    httpStatusHint: 400,
    category: "input",
    message: "Invalid request.",
    retryable: false
  }
};

/** Published rate limits per docs — useful for throttle config. */
export const DHAN_RATE_LIMITS = {
  order:      { perSecond: 10, perMinute: 250,  perHour: 1000,      perDay: 7000 },
  data:       { perSecond: 5,  perMinute: null, perHour: null,      perDay: 100_000 },
  quote:      { perSecond: 1,  perMinute: null, perHour: null,      perDay: null },
  nonTrading: { perSecond: 20, perMinute: null, perHour: null,      perDay: null }
} as const;

/** Try every shape Dhan uses for error payloads and return the catalog entry. */
export function lookupDhanError(payload: unknown): DhanErrorEntry | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;

  // Shape A: flat — { errorCode, errorType, errorMessage }
  const flatCode = typeof obj.errorCode === "string" ? obj.errorCode : null;
  if (flatCode && DHAN_ERROR_CATALOG[flatCode]) return DHAN_ERROR_CATALOG[flatCode];

  // Shape B: SDK-style — { status:"failure", remarks:{ error_code, ... } }
  const remarks = obj.remarks;
  if (remarks && typeof remarks === "object") {
    const code = (remarks as Record<string, unknown>).error_code;
    if (typeof code === "string" && DHAN_ERROR_CATALOG[code]) return DHAN_ERROR_CATALOG[code];
  }

  // Shape C: legacy map { "DH-XXX": "message" } at top level
  for (const key of Object.keys(obj)) {
    if (DHAN_ERROR_CATALOG[key]) return DHAN_ERROR_CATALOG[key];
  }

  // Shape D: nested data map (DhanClient.dhanErrorMessage style)
  const nested = obj.data;
  if (nested && typeof nested === "object") {
    for (const key of Object.keys(nested as Record<string, unknown>)) {
      if (DHAN_ERROR_CATALOG[key]) return DHAN_ERROR_CATALOG[key];
    }
  }

  return null;
}

export function isRetryableDhanError(code: string | null | undefined): boolean {
  if (!code) return false;
  return DHAN_ERROR_CATALOG[code]?.retryable ?? false;
}

export function getDhanErrorCategory(code: string | null | undefined): DhanErrorCategory | null {
  if (!code) return null;
  return DHAN_ERROR_CATALOG[code]?.category ?? null;
}
