/**
 * GET /api/dhan/stream
 *
 * Server-Sent Events endpoint that delivers real-time market ticks and order
 * updates to the browser. Designed for high-frequency Dhan WebSocket data.
 *
 * Performance architecture:
 *  • Ticks arrive from the Dhan WS at up to ~10 Hz per symbol.
 *  • Instead of forwarding every packet as a separate SSE event (900+ events/s
 *    for 90 symbols), we accumulate ticks in a per-client Map<securityId, tick>
 *    and flush it every FLUSH_INTERVAL_MS as a single `batch` SSE event.
 *  • The Map deduplicates automatically: only the latest tick per instrument
 *    is included in each flush — no stale/duplicate data.
 *  • On connect, a snapshot of all currently-known prices is sent immediately
 *    so the browser renders prices without waiting for the first flush interval.
 *
 * Result: the browser receives ~4 SSE events/second (not 900+), each carrying
 * all changed instruments as one JSON array. React can process this in a single
 * startTransition setState call, completely eliminating render-per-tick churn.
 *
 * Events emitted:
 *   status    — initial handshake {ok: true}
 *   batch     — JSON array of enriched ticks (flushed every FLUSH_INTERVAL_MS)
 *   order     — order update events (real-time, not batched)
 *   heartbeat — keepalive timestamp every 15 s
 */

import { dhanMarketFeedService } from "@/services/dhan/dhanMarketFeed";
import { dhanOrderUpdatesService } from "@/services/dhan/dhanOrderUpdates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tick accumulation window. 250 ms = 4 Hz flush rate. */
const FLUSH_INTERVAL_MS = 250;

export async function GET() {
  await dhanMarketFeedService.ensureConnected().catch(() => null);
  await dhanOrderUpdatesService.ensureConnected().catch(() => null);

  let cleanup: (() => void) | undefined;

  const stream = new ReadableStream({
    cancel() {
      cleanup?.();
    },

    start(controller) {
      const enc = new TextEncoder();
      let closed = false;

      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          closed = true;
        }
      };

      // ── Handshake ────────────────────────────────────────────────────────
      safeEnqueue(`event: status\ndata: ${JSON.stringify({ ok: true })}\n\n`);

      // ── Instant price snapshot ────────────────────────────────────────────
      // Send all currently-known prices so the browser can render immediately
      // on connect, rather than waiting for the next 250 ms flush window.
      const snapshot = dhanMarketFeedService.getSnapshot();
      if (snapshot.length > 0) {
        safeEnqueue(`event: batch\ndata: ${JSON.stringify(snapshot)}\n\n`);
      }

      // ── Per-client tick accumulator ───────────────────────────────────────
      // Keyed by securityId so we keep only the latest tick per instrument.
      // When the same symbol ticks 10× in 250 ms, we only transmit 1 entry.
      const pending = new Map<string, unknown>();

      const flush = () => {
        if (closed || pending.size === 0) return;
        const batch = Array.from(pending.values());
        pending.clear();
        safeEnqueue(`event: batch\ndata: ${JSON.stringify(batch)}\n\n`);
      };

      const flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);

      // ── Tick listener ─────────────────────────────────────────────────────
      const offTick = dhanMarketFeedService.onTick((tick) => {
        if (closed) return;
        const t = tick as Record<string, unknown>;
        const securityId = typeof t.securityId === "string" ? t.securityId : null;
        if (securityId) {
          // Accumulate — the latest tick for each symbol overwrites earlier ones.
          pending.set(securityId, tick);
        }
      });

      // ── Order updates (real-time, not batched) ────────────────────────────
      const offOrder = dhanOrderUpdatesService.onUpdate((event) => {
        safeEnqueue(`event: order\ndata: ${JSON.stringify(event)}\n\n`);
      });

      // ── Keepalive ─────────────────────────────────────────────────────────
      const heartbeat = setInterval(() => {
        safeEnqueue(`event: heartbeat\ndata: ${Date.now()}\n\n`);
      }, 15_000);

      // ── Cleanup ───────────────────────────────────────────────────────────
      cleanup = () => {
        if (closed) return;
        closed = true;
        offTick();
        offOrder();
        clearInterval(flushTimer);
        clearInterval(heartbeat);
      };
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy/CDN buffering so batch events reach the browser
      // immediately on flush instead of being held back by gzip/nginx.
      "X-Accel-Buffering": "no"
    }
  });
}
