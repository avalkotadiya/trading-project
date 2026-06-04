import axios, { AxiosError } from "axios";
import { logger } from "@/lib/logger";
import { lookupDhanError, isRetryableDhanError, type DhanErrorEntry } from "@/services/dhan/dhanErrorCodes";

const DHAN_API_BASE_URL = process.env.DHAN_API_BASE_URL || "https://api.dhan.co/v2";
const DHAN_AUTH_BASE_URL = process.env.DHAN_AUTH_BASE_URL || "https://auth.dhan.co";
const DEFAULT_TIMEOUT_MS = 12_000;
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export class DhanError extends Error {
  constructor(
    message: string,
    public readonly status = 500,
    public readonly code = "DHAN_REQUEST_FAILED",
    public readonly details?: unknown,
    /** Dhan-published error code from the response body (DH-9XX or 800/805/806/...). */
    public readonly dhanErrorCode?: string,
    /** Catalog entry resolved from the dhanErrorCode (category, retryable, canonical message). */
    public readonly dhanError?: DhanErrorEntry
  ) {
    super(message);
    this.name = "DhanError";
  }
}

type TokenProvider = () => Promise<string> | string;

/**
 * Per-call request options.
 *
 * `skipRetryOn429` — when true, do not perform the internal exponential-backoff
 * retry on HTTP 429 responses. Use this when the caller has its own outer-loop
 * throttle (e.g. dhanHistoricalData.ts token bucket) that needs to observe the
 * 429 immediately and apply a coordinated cooldown across all callers. Without
 * this, internal retries fire HTTP requests during the outer cooldown and
 * trigger Dhan's per-minute quota even though our bucket thinks it's paused.
 */
export type RequestOpts = {
  skipRetryOn429?: boolean;
};

function sanitizeError(error: unknown) {
  if (!(error instanceof AxiosError)) {
    return { message: error instanceof Error ? error.message : "Unknown error" };
  }

  return {
    message: error.message,
    status: error.response?.status,
    data: error.response?.data
  };
}

function dhanErrorMessage(data: unknown) {
  if (!data || typeof data !== "object") return "Dhan request failed.";
  const nested = (data as { data?: unknown }).data;
  if (!nested || typeof nested !== "object") return "Dhan request failed.";
  const messages = Object.entries(nested as Record<string, unknown>)
    .map(([code, message]) => (typeof message === "string" ? `Dhan ${code}: ${message}` : null))
    .filter(Boolean);
  return messages[0] ?? "Dhan request failed.";
}

/** Parse a Retry-After header (delay-seconds or HTTP-date) into milliseconds. */
function retryAfterMs(error: unknown): number | null {
  if (!(error instanceof AxiosError)) return null;
  const header = error.response?.headers?.["retry-after"];
  if (header === undefined || header === null || header === "") return null;

  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(15_000, Math.max(0, seconds * 1000));

  const dateMs = Date.parse(String(header));
  if (Number.isFinite(dateMs)) return Math.min(15_000, Math.max(0, dateMs - Date.now()));
  return null;
}

function isHistoricalNoDataOrInputException(path: string, safe: { status?: number; data?: unknown }) {
  if (safe.status !== 400) return false;
  if (path !== "/charts/historical" && path !== "/charts/intraday") return false;
  if (!safe.data || typeof safe.data !== "object") return false;
  const data = safe.data as Record<string, unknown>;
  const errorCode = typeof data.errorCode === "string" ? data.errorCode.toUpperCase() : "";
  const errorType = typeof data.errorType === "string" ? data.errorType.toUpperCase() : "";
  const errorMessage = typeof data.errorMessage === "string" ? data.errorMessage.toLowerCase() : "";
  return (
    errorCode === "DH-905" ||
    errorType === "INPUT_EXCEPTION" ||
    errorMessage.includes("no data") ||
    errorMessage.includes("incorrect parameters") ||
    errorMessage.includes("missing required fields") ||
    errorMessage.includes("bad values for parameters")
  );
}

/**
 * Resolve the Dhan-published error code from the response body (DH-9XX or 800/805/...).
 * Checks every shape Dhan uses: flat { errorCode }, SDK-wrapped { remarks.error_code },
 * legacy nested data map, etc. Returns null if no recognised code is present.
 */
function resolveDhanErrorCode(safe: { data?: unknown }): { code: string; entry: ReturnType<typeof lookupDhanError> } | null {
  const entry = lookupDhanError(safe.data);
  if (entry) return { code: entry.code, entry };
  return null;
}

function isCallerManagedRateLimit(
  safe: { status?: number; data?: unknown },
  dhanResolved: ReturnType<typeof resolveDhanErrorCode>,
  opts?: RequestOpts
) {
  if (!opts?.skipRetryOn429) return false;
  return safe.status === 429 || dhanResolved?.entry?.category === "rate-limit";
}

export class DhanClient {
  private readonly rest = axios.create({
    baseURL: DHAN_API_BASE_URL,
    timeout: DEFAULT_TIMEOUT_MS,
    proxy: false
  });

  private readonly authRest = axios.create({
    baseURL: DHAN_AUTH_BASE_URL,
    timeout: DEFAULT_TIMEOUT_MS,
    proxy: false
  });

  constructor(private readonly getAccessToken: TokenProvider) {}

  async get<T>(path: string, opts?: RequestOpts) {
    return this.request<T>("get", path, undefined, opts);
  }

  async post<T>(path: string, body?: unknown, opts?: RequestOpts) {
    return this.request<T>("post", path, body, opts);
  }

  async put<T>(path: string, body?: unknown, opts?: RequestOpts) {
    return this.request<T>("put", path, body, opts);
  }

  async delete<T>(path: string, opts?: RequestOpts) {
    return this.request<T>("delete", path, undefined, opts);
  }

  async postAuth<T>(path: string, body?: unknown, headers?: Record<string, string>) {
    try {
      const response = await this.authRest.post<T>(path, body, {
        headers: {
          "Content-Type": "application/json",
          ...headers
        }
      });
      return response.data;
    } catch (error) {
      const safe = sanitizeError(error);
      logger.error("Dhan auth request failed", { safe });
      throw new DhanError("Dhan auth request failed.", safe.status ?? 500, "DHAN_AUTH_FAILED", safe.data);
    }
  }

  private async request<T>(
    method: "get" | "post" | "put" | "delete",
    path: string,
    body?: unknown,
    opts?: RequestOpts
  ) {
    // At least 4 attempts: a transient DH-904 burst rate-limit usually clears
    // within a second or two, so retrying with backoff recovers it cleanly.
    const maxAttempts = Math.max(4, Number(process.env.DHAN_RETRY_ATTEMPTS || "4"));
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const token = await this.getAccessToken();
        const clientId = process.env.DHAN_CLIENT_ID?.trim();
        const response = await this.rest.request<T>({
          method,
          url: path,
          data: body,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "access-token": token,
            ...(clientId ? { "client-id": clientId } : {})
          }
        });
        return response.data;
      } catch (error) {
        lastError = error;
        const safe = sanitizeError(error);
        const dhanResolved = resolveDhanErrorCode(safe);

        // Caller opt-out: an outer throttle (e.g. dhanHistoricalData token bucket)
        // owns Dhan rate-limit retries so they're coordinated across all callers
        // and respect a shared cooldown. Dhan can report the same quota hit as
        // DH-904/805 in the body even when the transport status is not 429.
        if (isCallerManagedRateLimit(safe, dhanResolved, opts)) break;

        // Consult the Dhan error catalog first — a body-level errorCode is
        // authoritative over the HTTP status because Dhan sometimes returns
        // DH-905 (input error, do-not-retry) as HTTP 500, or DH-904 (rate limit,
        // retryable) inside an HTTP 200 envelope.
        if (dhanResolved && !isRetryableDhanError(dhanResolved.code)) break;

        const httpRetryable = safe.status !== undefined && RETRYABLE_STATUSES.has(safe.status);
        const dhanRetryable = dhanResolved ? isRetryableDhanError(dhanResolved.code) : false;
        const shouldRetry = (httpRetryable || dhanRetryable) && attempt < maxAttempts;
        if (!shouldRetry) break;

        // Honour Retry-After when the server sends it; otherwise exponential
        // backoff with jitter (≈600ms, 1.2s, 2.4s, 4.8s) to clear the burst.
        const backoff = retryAfterMs(error) ?? Math.min(8_000, 600 * 2 ** (attempt - 1));
        await new Promise((resolve) => setTimeout(resolve, backoff + Math.floor(Math.random() * 200)));
      }
    }

    try {
      throw lastError;
    } catch (error) {
      const safe = sanitizeError(error);
      // 429s under an outer throttle are expected/normal — don't log them as errors.
      const historicalNoData = isHistoricalNoDataOrInputException(path, {
        status: safe.status,
        data: safe.data
      });
      const dhanResolved = resolveDhanErrorCode(safe);
      const callerManagedRateLimit = isCallerManagedRateLimit(safe, dhanResolved, opts);
      if (!callerManagedRateLimit && !historicalNoData) {
        logger.error("Dhan REST request failed", { method, path, safe });
      } else if (historicalNoData) {
        logger.info("Dhan historical request returned no-data/invalid-params", {
          method,
          path,
          status: safe.status
        });
      }
      const message = dhanResolved
        ? `Dhan ${dhanResolved.code}: ${dhanResolved.entry?.message ?? dhanErrorMessage(safe.data)}`
        : dhanErrorMessage(safe.data);
      throw new DhanError(
        message,
        dhanResolved?.entry?.httpStatusHint ?? safe.status ?? 500,
        "DHAN_REQUEST_FAILED",
        safe.data,
        dhanResolved?.code,
        dhanResolved?.entry ?? undefined
      );
    }
  }
}
