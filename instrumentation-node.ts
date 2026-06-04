/**
 * Node-runtime instrumentation. Loaded ONLY when NEXT_RUNTIME === "nodejs"
 * via the dispatcher in `instrumentation.ts`, so it's safe to pull in modules
 * that need `node:fs`, the Prisma client, or anything else Edge can't run.
 *
 * Three jobs:
 *  1. Install Node deprecation-warning suppressions.
 *  2. Start the autonomous bot ticker — drives runEnabledBotCycles() on a
 *     setInterval so the AI Quant Bot trades on its own without the dashboard
 *     tab needing to be open.
 *  3. Co-host the market-data WebSocket gateway on REALTIME_PORT so the
 *     dashboard's live-tick socket (ws://…/ws) works without having to also
 *     run `npm run realtime:dev` in a second terminal. Shares the same
 *     marketDataService singleton as the bot, so a single Dhan WS connection
 *     feeds both.
 *
 * Both background tasks live only as long as the Node process does. On
 * serverless (Vercel), neither runs — hit /api/bot/cron from an external
 * scheduler and host the WS gateway separately.
 */

import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { installNodeWarningSuppressions } from "@/lib/suppress-node-warnings";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { runEnabledBotCycles } from "@/services/ai/auto-trader.service";
import { marketDataService } from "@/services/market-data/market-data.service";
import { MarketWebSocketGateway } from "@/services/market-data/market-websocket.gateway";

installNodeWarningSuppressions();
void startAutonomousBotTicker();
void startCoHostedRealtimeGateway();

declare global {
  var __sahara_bot_ticker_started: boolean | undefined;
  var __sahara_realtime_started: boolean | undefined;
}

/* ------------------------------------------------------------------ */
/*  Autonomous bot ticker                                              */
/* ------------------------------------------------------------------ */

async function startAutonomousBotTicker() {
  // Hot-reload in dev re-imports this file; guard against stacking tickers.
  if (globalThis.__sahara_bot_ticker_started) return;

  // Default to a 5-minute tick when env not set. The bot now scans the full
  // Dhan instrument master (thousands of symbols across all segments), so a
  // 60s cadence would queue cycles before the previous one finished. The
  // per-cycle edge-signals call hits Redis cache (QUANT_EDGE_CACHE_SECONDS,
  // default 30 min) so most ticks are still fast. Set BOT_AUTOTICK_SECONDS=0
  // to explicitly opt out (e.g. on serverless where instrumentation can't
  // keep state).
  const rawPeriod = process.env.BOT_AUTOTICK_SECONDS;
  const periodSec = rawPeriod === undefined ? 300 : Number(rawPeriod);
  if (!Number.isFinite(periodSec) || periodSec <= 0) {
    logger.info("[BotTicker] BOT_AUTOTICK_SECONDS=0 or invalid — autonomous mode opted out.");
    return;
  }

  if (!(await canReachDatabase())) {
    logger.warn("[BotTicker] Postgres is not reachable; autonomous bot ticker not started.");
    return;
  }

  // Optional one-shot: flip every user's bot ON at boot. Gated by env so it
  // never silently re-enables a bot you deliberately paused — restart only.
  if (process.env.BOT_AUTO_ENABLE_ON_STARTUP === "true") {
    try {
      const flipped = await prisma.user.updateMany({
        where: { autoTradeEnabled: false },
        data: { autoTradeEnabled: true }
      });
      if (flipped.count > 0) {
        logger.info(`[BotTicker] Auto-enabled bot for ${flipped.count} user(s) on startup.`);
      }
    } catch (error) {
      logger.warn(
        `[BotTicker] Could not auto-enable bot on startup: ${error instanceof Error ? error.message : "unknown"}`
      );
    }
  }

  globalThis.__sahara_bot_ticker_started = true;
  logger.info(`[BotTicker] Autonomous bot tick every ${periodSec}s — engine is server-driven now.`);

  let running = false;
  const tick = async () => {
    if (running) return; // a slow cycle must never overlap the next tick
    running = true;
    try {
      const result = await runEnabledBotCycles();
      if (result.users > 0) {
        logger.info(
          `[BotTicker] cycle: ${result.ran}/${result.users} ran · ${result.entries} entries · ${result.exits} exits` +
            (result.errors.length ? ` · ${result.errors.length} error(s)` : "")
        );
      }
    } catch (error) {
      logger.error(`[BotTicker] cycle threw: ${error instanceof Error ? error.message : "unknown"}`);
    } finally {
      running = false;
    }
  };

  // Keep boot fast by default. A cold quant scan can hit Dhan historical
  // throttles, so only run the first cycle immediately when explicitly asked.
  if (process.env.BOT_AUTOTICK_RUN_ON_STARTUP === "true") {
    setTimeout(tick, 5_000);
  }
  setInterval(tick, periodSec * 1_000);
}

async function canReachDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.warn(`[BotTicker] Database health check failed: ${formatStartupError(error)}`);
    return false;
  }
}

function formatStartupError(error: unknown) {
  if (error instanceof Error) {
    const code = "code" in error ? String(error.code) : "";
    return code ? `${code}: ${error.message}` : error.message;
  }

  return "unknown";
}

/* ------------------------------------------------------------------ */
/*  Co-hosted market-data WebSocket gateway                            */
/* ------------------------------------------------------------------ */

async function startCoHostedRealtimeGateway() {
  if (globalThis.__sahara_realtime_started) return;
  if (process.env.REALTIME_GATEWAY_DISABLED === "true") {
    logger.info("[Realtime] Co-hosted gateway disabled via REALTIME_GATEWAY_DISABLED=true.");
    return;
  }

  const port = Number(process.env.REALTIME_PORT ?? 3001);
  if (!Number.isFinite(port) || port <= 0) {
    logger.warn(`[Realtime] Invalid REALTIME_PORT (${process.env.REALTIME_PORT}); gateway not started.`);
    return;
  }

  if (!(await isPortAvailable(port))) {
    globalThis.__sahara_realtime_started = true;
    logger.warn(
      `[Realtime] Port ${port} already in use — assuming a standalone realtime-server is running; skipping co-host.`
    );
    return;
  }

  // Mark started immediately so a hot-reload during boot can't queue a second
  // listener that would EADDRINUSE itself.
  globalThis.__sahara_realtime_started = true;

  const server = createServer((_request, response) => {
    // We only need this HTTP server as a host for the WebSocket upgrade; no
    // routes are served. /health is on the main Next app at /api/market/health.
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("Not Found — this port hosts the market data WebSocket at /ws.");
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      // Someone is already serving 3001 — most likely the standalone
      // `npm run realtime:dev` process. That's fine; let it own the port.
      logger.warn(
        `[Realtime] Port ${port} already in use — assuming a standalone realtime-server is running; skipping co-host.`
      );
      return;
    }
    logger.warn(`[Realtime] Gateway HTTP server error: ${err.message}`);
  });

  try {
    const gateway = new MarketWebSocketGateway(server, marketDataService);
    gateway.start();
    server.listen(port, () => {
      logger.info(`[Realtime] Co-hosted market data WS gateway listening on :${port}/ws`);
    });
  } catch (error) {
    logger.warn(
      `[Realtime] Could not start gateway: ${error instanceof Error ? error.message : "unknown"}`
    );
  }
}

function isPortAvailable(port: number) {
  return new Promise<boolean>((resolve) => {
    const probe = createTcpServer();

    probe.once("error", () => resolve(false));
    probe.once("listening", () => {
      probe.close(() => resolve(true));
    });
    probe.listen(port);
  });
}
