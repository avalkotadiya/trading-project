/**
 * GET /api/bot/signals/stream
 *
 * Server-Sent Events feed for the quant-edge scanner. Lets the bot UI render
 * each EdgeSignal as it's computed, instead of waiting 30-60 min for a full
 * universe scan to complete.
 *
 * Events:
 *   status    — initial handshake { ok: true }
 *   snapshot  — array of currently-cached signals (sent on connect so the UI
 *               renders the prior scan's result immediately rather than blank)
 *   signal    — one EdgeSignal as soon as it's produced by the scanner
 *   progress  — scan status { scanning, processed, total, kept, dropped }
 *   complete  — terminal scan-finished payload with kept/dropped totals
 *   heartbeat — keepalive every 25 s so proxies don't kill an idle stream
 */

import {
  getCachedEdgeSignals,
  getEdgeScanStatus,
  subscribeEdgeScanStatus,
  subscribeEdgeSignals,
  type EdgeScanStatus
} from "@/services/ai/quant-edge.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let cleanup: (() => void) | undefined;

  const stream = new ReadableStream({
    cancel() {
      cleanup?.();
    },

    async start(controller) {
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

      const sendEvent = (event: string, data: unknown) => {
        safeEnqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      // ── Handshake ──────────────────────────────────────────────────────────
      sendEvent("status", { ok: true });

      // ── Snapshot: replay whatever is already cached so the UI renders the
      //   previous scan's result immediately on connect. New signals from the
      //   current/next scan flow in via the `signal` event.
      try {
        const cached = await getCachedEdgeSignals({ warmIfMissing: true });
        if (cached && cached.length > 0) {
          sendEvent("snapshot", cached);
        }
      } catch {
        // best-effort — if cache lookup fails, just continue to live events
      }

      // ── Initial progress so the UI's "0 / N" indicator renders without
      //   waiting for the first symbol to complete.
      sendEvent("progress", getEdgeScanStatus());

      // ── Live signal feed ───────────────────────────────────────────────────
      const offSignal = subscribeEdgeSignals((signal) => {
        sendEvent("signal", signal);
      });

      const offStatus = subscribeEdgeScanStatus((status: EdgeScanStatus) => {
        sendEvent("progress", status);
        if (!status.scanning && status.finishedAt) {
          sendEvent("complete", status);
        }
      });

      // ── Keepalive (proxies/CDNs may close idle SSE streams without this).
      const heartbeat = setInterval(() => {
        sendEvent("heartbeat", { ts: Date.now() });
      }, 25_000);

      cleanup = () => {
        if (closed) return;
        closed = true;
        offSignal();
        offStatus();
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
