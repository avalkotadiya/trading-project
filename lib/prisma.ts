import { PrismaClient } from "@/lib/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { getDatabaseUrl } from "@/lib/env";
import { runStartupChecks } from "@/lib/startup-checks";
import { installNodeWarningSuppressions } from "@/lib/suppress-node-warnings";

installNodeWarningSuppressions();

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

const isFirstInit = !globalForPrisma.prisma;

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg(getDatabaseUrl() ?? ""),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"]
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Run security checks once per process start (not on every hot-reload import)
if (isFirstInit) {
  runStartupChecks();
}
