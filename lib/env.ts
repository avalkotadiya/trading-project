/**
 * Environment variable helpers.
 */

export function hasRealEnvValue(value: string | undefined) {
  return Boolean(value && !value.includes("replace_me"));
}

export function isClerkConfigured() {
  return (
    hasRealEnvValue(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) &&
    hasRealEnvValue(process.env.CLERK_SECRET_KEY)
  );
}

export function getQuantEngineUrl() {
  return process.env.QUANT_ENGINE_URL || "http://127.0.0.1:8000";
}

export function isBrokerConfigured() {
  return (
    hasRealEnvValue(process.env.BROKER_API_KEY) &&
    hasRealEnvValue(process.env.BROKER_API_SECRET)
  );
}

function getRawDatabaseUrl() {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_URL
  );
}

function withPrismaConnectionLimit(databaseUrl: string | undefined) {
  if (!databaseUrl) return undefined;

  try {
    const url = new URL(databaseUrl);

    if (
      (url.protocol === "postgres:" || url.protocol === "postgresql:") &&
      !url.searchParams.has("connection_limit")
    ) {
      const defaultLimit = url.searchParams.get("pgbouncer") === "true" ? "3" : "1";
      url.searchParams.set(
        "connection_limit",
        process.env.PRISMA_CONNECTION_LIMIT ?? defaultLimit
      );
    }

    return url.toString();
  } catch {
    return databaseUrl;
  }
}

/**
 * Returns the resolved, connection-limit-annotated database URL.
 * Does NOT mutate process.env — pass the result directly to PrismaClient.
 */
export function getDatabaseUrl() {
  return withPrismaConnectionLimit(getRawDatabaseUrl());
}
