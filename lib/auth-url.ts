const DEFAULT_AUTH_REDIRECT = "/dashboard";
const SENSITIVE_QUERY_KEYS = new Set(["password", "pass", "pwd", "current_password", "new_password", "confirm_password"]);
const AUTH_PREFILL_QUERY_KEYS = new Set(["email", "username", "login"]);

export function isSensitiveQueryParam(key: string) {
  const normalized = key.toLowerCase();
  return SENSITIVE_QUERY_KEYS.has(normalized) || normalized.includes("password");
}

export function sanitizeRedirectPath(value?: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_AUTH_REDIRECT;
  }

  try {
    const url = new URL(value, "http://local.test");
    for (const key of Array.from(url.searchParams.keys())) {
      if (isSensitiveQueryParam(key)) {
        url.searchParams.delete(key);
      }
    }

    return `${url.pathname}${url.search}${url.hash}` || DEFAULT_AUTH_REDIRECT;
  } catch {
    return DEFAULT_AUTH_REDIRECT;
  }
}

export function sanitizeAuthRedirectParam(value?: string | null) {
  const sanitized = sanitizeRedirectPath(value);
  return sanitized === DEFAULT_AUTH_REDIRECT ? undefined : sanitized;
}

export function shouldStripAuthSearchParam(key: string) {
  const normalized = key.toLowerCase();
  return isSensitiveQueryParam(normalized) || AUTH_PREFILL_QUERY_KEYS.has(normalized);
}

export function sanitizeAuthSearchParams(params: URLSearchParams) {
  const clean = new URLSearchParams();
  const redirectUrl = sanitizeAuthRedirectParam(params.get("redirect_url"));

  if (redirectUrl) {
    clean.set("redirect_url", redirectUrl);
  }

  return clean;
}

export function hasUnsafeQueryParams(params: URLSearchParams, includeAuthPrefill = false) {
  for (const key of params.keys()) {
    if (isSensitiveQueryParam(key)) return true;
    if (includeAuthPrefill && shouldStripAuthSearchParam(key) && key.toLowerCase() !== "redirect_url") return true;
  }

  const redirectUrl = params.get("redirect_url");
  return Boolean(redirectUrl && sanitizeRedirectPath(redirectUrl) !== redirectUrl);
}
