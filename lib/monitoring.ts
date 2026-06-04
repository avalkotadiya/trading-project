import { prisma } from "@/lib/prisma";
import { getCacheProviderName } from "@/lib/cache";
import { isDatabaseConfigured } from "@/lib/auth";
import { logger } from "@/lib/logger";

export async function getSystemHealth() {
  let database = "not_configured";

  if (isDatabaseConfigured()) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      database = "ok";
    } catch (error) {
      database = "degraded";
      logger.warn("Database health check failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    status: database === "degraded" ? "degraded" : "ok",
    database,
    cache: getCacheProviderName(),
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  };
}

export function getRuntimeMetrics() {
  const memory = process.memoryUsage();

  return {
    uptimeSeconds: Math.round(process.uptime()),
    memory: {
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal
    },
    cacheProvider: getCacheProviderName(),
    nodeEnv: process.env.NODE_ENV ?? "unknown",
    timestamp: new Date().toISOString()
  };
}
