#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../lib/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";

function getRawDatabaseUrl() {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_URL
  );
}

function getDatabaseUrl() {
  const value = getRawDatabaseUrl();
  if (!value) return "";

  try {
    const url = new URL(value);
    if (
      (url.protocol === "postgres:" || url.protocol === "postgresql:") &&
      !url.searchParams.has("connection_limit")
    ) {
      url.searchParams.set(
        "connection_limit",
        process.env.PRISMA_CONNECTION_LIMIT ?? (url.searchParams.get("pgbouncer") === "true" ? "3" : "1")
      );
    }
    return url.toString();
  } catch {
    return value;
  }
}

const prisma = new PrismaClient({
  adapter: new PrismaPg(getDatabaseUrl()),
  log: ["error"]
});

try {
  await prisma.$queryRaw`SELECT 1`;
  const columns = await prisma.$queryRaw`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'User'
      AND column_name IN ('autoTradeEnabled', 'botMinCompositeScore', 'botTrailStartPct', 'botTrailDistancePct')
    ORDER BY column_name
  `;
  console.log(JSON.stringify({ ok: true, userColumns: columns }, null, 2));
} catch (error) {
  console.dir(error, { depth: 10 });
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
