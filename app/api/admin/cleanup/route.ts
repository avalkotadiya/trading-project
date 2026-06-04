import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/auth";
import { logger } from "@/lib/logger";

/**
 * Session Cleanup Cron — Killer Feature #1
 *
 * Expired `AuthSession` rows accumulate indefinitely in the database because
 * the previous implementation only deleted sessions reactively (when a user
 * tried to authenticate with a stale token). On a production app with real
 * traffic this will degrade the AuthSession table query performance over time.
 *
 * This route is designed to be called by a scheduled job (Vercel Cron, GitHub
 * Actions, or any HTTP scheduler) once per day.
 *
 * Security: requests must include the Authorization header with the value
 * `Bearer <MONITORING_TOKEN>` — the same token used by the health-check
 * endpoints. Without this the route returns 401.
 *
 * Example Vercel cron config (vercel.json):
 *   {
 *     "crons": [{ "path": "/api/admin/cleanup", "schedule": "0 2 * * *" }]
 *   }
 */
export async function POST(request: NextRequest) {
  // Bearer token guard — prevents public access to a destructive endpoint
  const authHeader = request.headers.get("authorization");
  const token = process.env.MONITORING_TOKEN;

  const isAuthorised =
    token &&
    !token.includes("replace_me") &&
    authHeader === `Bearer ${token}`;

  if (!isAuthorised) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ ok: true, deleted: 0, reason: "database_not_configured" });
  }

  try {
    const result = await prisma.authSession.deleteMany({
      where: { expiresAt: { lt: new Date() } }
    });

    logger.info("Session cleanup complete", { deleted: result.count });

    return NextResponse.json({
      ok: true,
      deleted: result.count,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Session cleanup failed", { error: message });

    return NextResponse.json(
      { ok: false, error: "Cleanup failed", message },
      { status: 500 }
    );
  }
}
