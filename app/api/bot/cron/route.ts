import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { runEnabledBotCycles } from "@/services/ai/auto-trader.service";

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const tokens = [process.env.CRON_SECRET, process.env.MONITORING_TOKEN]
    .map((token) => token?.trim())
    .filter((token): token is string => Boolean(token && !token.includes("replace_me")));

  return tokens.some((token) => authHeader === `Bearer ${token}`);
}

async function handler(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ ok: true, users: 0, ran: 0, entries: 0, exits: 0, reason: "database_not_configured" });
  }

  try {
    const result = await runEnabledBotCycles();
    logger.info("Bot cron complete", result);
    return NextResponse.json({ ok: true, ...result, timestamp: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Bot cron failed", { error: message });
    return NextResponse.json({ ok: false, error: "Bot cron failed", message }, { status: 500 });
  }
}

export const GET = handler;
export const POST = handler;
