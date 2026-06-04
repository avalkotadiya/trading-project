/**
 * Startup security checks.
 *
 * Imported once by lib/prisma.ts so it runs when the Prisma client is first
 * initialised (server boot). Warnings are written to stderr — they don't
 * throw, so the app still boots, but operators see them immediately in logs.
 */

const FALLBACK_SALT = "sahara-ip-default-salt";

function isLocalUrl(value: string | undefined) {
  if (!value) return false;

  try {
    const hostname = new URL(value).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function isLocalBuildOrRuntime() {
  return (
    process.env.NODE_ENV !== "production" ||
    isLocalUrl(process.env.NEXT_PUBLIC_APP_URL) ||
    process.env.VERCEL_ENV === "development"
  );
}

const checks: Array<{ condition: () => boolean; message: string }> = [
  {
    condition: () => !process.env.IP_HASH_SALT || process.env.IP_HASH_SALT === FALLBACK_SALT,
    message:
      "IP_HASH_SALT is not set or uses the default value. Audit-log IP hashes are predictable. Set a random 32-char string in your environment."
  },
  {
    condition: () =>
      !process.env.DHAN_WEBHOOK_IP_ALLOWLIST &&
      !process.env.DHAN_WEBHOOK_SECRET,
    message:
      "DHAN_WEBHOOK_IP_ALLOWLIST and DHAN_WEBHOOK_SECRET are both unset. The Dhan webhook endpoint is publicly accessible with no authentication."
  },
  {
    condition: () => !process.env.RAZORPAY_WEBHOOK_SECRET,
    message:
      "RAZORPAY_WEBHOOK_SECRET is not set. The billing webhook will reject all requests (501). Set it to enable payment processing."
  },
  {
    condition: () =>
      !process.env.DATABASE_URL &&
      !process.env.POSTGRES_PRISMA_URL &&
      !process.env.POSTGRES_URL_NON_POOLING &&
      !process.env.POSTGRES_URL,
    message: "No DATABASE_URL is set. The application will fail to start or run in a degraded state."
  },
  {
    condition: () =>
      process.env.NODE_ENV === "production" &&
      !isLocalBuildOrRuntime() &&
      (!process.env.REDIS_URL || process.env.REDIS_URL === "redis://localhost:6379"),
    message:
      "REDIS_URL points to localhost in a production environment. Auth rate limiting will fall back to in-memory (not shared across instances)."
  }
];

export function runStartupChecks() {
  if (process.env.NODE_ENV === "test") return;

  for (const check of checks) {
    if (check.condition()) {
      process.stderr.write(
        JSON.stringify({
          level: "warn",
          message: `[STARTUP] Security misconfiguration: ${check.message}`,
          timestamp: new Date().toISOString()
        }) + "\n"
      );
    }
  }
}
