import type { IncomingMessage, Server } from "node:http";
import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";
import { marketDataService, type MarketDataService } from "@/services/market-data/market-data.service";
import type { NormalizedTick } from "@/services/market-data/market-data.types";
import { getSubscriptionKey, resolveMarketSymbols } from "@/services/market-data/symbol-mapper.service";
import { redis } from "@/lib/redis";
import { hashToken } from "@/lib/session";
import { AutomationManager } from "@/lib/execution/automation-manager";
import { logger } from "@/lib/logger";
import { sanitizeSymbol } from "@/lib/sanitize";

const MAX_SYMBOLS_PER_CLIENT = 50;

type ClientState = {
  isAlive: boolean;
  subscriptions: Set<string>;
};

const heartbeatMs = 30_000;

function parseSymbolsFromRequest(request: IncomingMessage) {
  const url = new URL(request.url ?? "/ws", "http://localhost");
  const symbols = url.searchParams.get("symbols");
  return symbols?.split(",").map((symbol) => symbol.trim()).filter(Boolean) ?? [];
}

export class MarketWebSocketGateway {
  private readonly wss: WebSocketServer;
  private readonly clients = new Map<WebSocket, ClientState>();
  private heartbeat?: ReturnType<typeof setInterval>;
  private unsubscribeTick?: () => void;

  // Offline queue must stay ON for the subscriber connection: the psubscribe
  // below runs in the constructor before the socket is ready. ioredis flushes
  // the queued command once connected and re-subscribes after a reconnect.
  private readonly redisSub = redis.duplicate({
    enableOfflineQueue: true,
    maxRetriesPerRequest: null
  });

  constructor(
    server: Server,
    private readonly service: MarketDataService = marketDataService
  ) {
    this.wss = new WebSocketServer({ server, path: "/ws" });

    // Without this handler, every Redis reconnect attempt (e.g. while Docker
    // is restarting) prints "[ioredis] Unhandled error event" to stderr.
    // ioredis already retries internally; we just need to swallow the noise.
    this.redisSub.on("error", () => {
      // Signal stream resumes automatically when Redis is reachable again.
    });

    // Listen for AI Signals and Risk Alerts from the Python Engine
    this.redisSub.psubscribe("SIGNAL:*", "PORTFOLIO:RISK_ALERT", (err) => {
      if (err) logger.error("Failed to subscribe to AI signals/alerts", { error: String(err) });
    });

    this.redisSub.on("pmessage", (pattern, channel, message) => {
      try {
        const data = JSON.parse(message);

        if (channel.startsWith("SIGNAL:")) {
          logger.info("Gateway: AI signal received", { channel });
          this.broadcastSignal(data);
          // Trigger Auto-Trading Automation
          void AutomationManager.handleSignal(data);
        } else if (channel === "PORTFOLIO:RISK_ALERT") {
          logger.info("Gateway: risk alert received");
          this.broadcastAlert(data);
        }
      } catch (e) {
        logger.error("Gateway: failed to parse AI message", { error: String(e) });
      }
    });
  }
  start() {
    this.unsubscribeTick = this.service.onTick((tick) => this.broadcastTick(tick));

    this.wss.on("connection", async (socket, request) => {
      const url = new URL(request.url ?? "/ws", "http://localhost");
      const token = url.searchParams.get("token");

      if (!token) {
        socket.close(1008, "Policy Violation: Authentication required.");
        return;
      }

      // Verify token against Redis
      const hashedToken = hashToken(token);
      const userId = await redis.get(`session:${hashedToken}`);

      if (!userId) {
        socket.close(1008, "Invalid or expired session token.");
        return;
      }

      this.clients.set(socket, {
        isAlive: true,
        subscriptions: new Set()
      });

      socket.on("pong", () => {
        const state = this.clients.get(socket);

        if (state) {
          state.isAlive = true;
        }
      });

      socket.on("message", (rawMessage) => {
        void this.handleMessage(socket, rawMessage.toString());
      });

      socket.on("close", () => {
        this.clients.delete(socket);
      });

      socket.send(JSON.stringify({ type: "connected", service: "sahara-market-data" }));

      const initialSymbols = parseSymbolsFromRequest(request);

      if (initialSymbols.length > 0) {
        void this.subscribeClient(socket, initialSymbols).catch((err) => {
          logger.error("Gateway: subscribeClient error", { error: String(err) });
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ type: "error", message: "Subscribe failed." }));
          }
        });
      }
    });

    this.heartbeat = setInterval(() => this.pingClients(), heartbeatMs);
  }

  async close() {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }

    this.unsubscribeTick?.();
    await this.service.disconnect();
    this.wss.close();
  }

  private async handleMessage(socket: WebSocket, message: string) {
    if (message.length > 4096) {
      socket.send(JSON.stringify({ type: "error", message: "Message too large." }));
      return;
    }

    try {
      const payload = JSON.parse(message) as { type?: string; symbols?: unknown };

      if (payload.type === "subscribe" || payload.type === "unsubscribe") {
        if (!Array.isArray(payload.symbols)) {
          socket.send(JSON.stringify({ type: "error", message: "symbols must be an array." }));
          return;
        }

        // Sanitize: max 50 symbols, each max 20 chars, valid format only
        const symbols = (payload.symbols as unknown[])
          .slice(0, MAX_SYMBOLS_PER_CLIENT)
          .filter((s): s is string => typeof s === "string" && s.length > 0)
          .map((s) => sanitizeSymbol(s))
          .filter(Boolean);

        if (symbols.length === 0) {
          socket.send(JSON.stringify({ type: "error", message: "No valid symbols provided." }));
          return;
        }

        const state = this.clients.get(socket);
        if (payload.type === "subscribe" && state && state.subscriptions.size + symbols.length > MAX_SYMBOLS_PER_CLIENT) {
          socket.send(JSON.stringify({ type: "error", message: `Cannot subscribe to more than ${MAX_SYMBOLS_PER_CLIENT} symbols.` }));
          return;
        }

        if (payload.type === "subscribe") {
          await this.subscribeClient(socket, symbols);
        } else {
          await this.unsubscribeClient(socket, symbols);
        }
        return;
      }

      if (payload.type === "ping") {
        socket.send(JSON.stringify({ type: "pong", at: new Date().toISOString() }));
      }
    } catch {
      socket.send(JSON.stringify({ type: "error", message: "Invalid websocket message." }));
    }
  }

  private async subscribeClient(socket: WebSocket, inputs: string[]) {
    const symbols = await this.service.subscribe(inputs);
    const state = this.clients.get(socket);

    if (state) {
      symbols.forEach((symbol) => state.subscriptions.add(getSubscriptionKey(symbol)));
    }

    socket.send(
      JSON.stringify({
        type: "subscribed",
        symbols: symbols.map(getSubscriptionKey),
        at: new Date().toISOString()
      })
    );
  }

  private async unsubscribeClient(socket: WebSocket, inputs: string[]) {
    const symbols = resolveMarketSymbols(inputs);
    const state = this.clients.get(socket);

    if (state) {
      symbols.forEach((symbol) => state.subscriptions.delete(getSubscriptionKey(symbol)));
    }

    const removable = symbols.filter((symbol) => {
      const key = getSubscriptionKey(symbol);
      return !Array.from(this.clients.values()).some((clientState) => clientState.subscriptions.has(key));
    });

    if (removable.length > 0) {
      await this.service.unsubscribe(removable.map(getSubscriptionKey));
    }

    socket.send(
      JSON.stringify({
        type: "unsubscribed",
        symbols: symbols.map(getSubscriptionKey),
        at: new Date().toISOString()
      })
    );
  }

  private broadcastTick(tick: NormalizedTick) {
    const payload = JSON.stringify({ type: "market.tick", tick, at: new Date().toISOString() });
    const key = getSubscriptionKey(tick);

    for (const [client, state] of this.clients) {
      if (client.readyState === client.OPEN && state.subscriptions.has(key)) {
        client.send(payload);
      }
    }
  }

  private broadcastSignal(signal: { symbol: string; direction: string; confidence: number; strategy: string; entryPrice: number; timeframe: string; summary: string; timestamp?: string }) {
    const payload = JSON.stringify({ type: "ai.signal", signal, at: new Date().toISOString() });
    
    for (const client of this.clients.keys()) {
      if (client.readyState === client.OPEN) {
        client.send(payload);
      }
    }
  }

  private broadcastAlert(alert: { type: string; severity: string; trigger: string; suggestion: string; timestamp: string }) {
    const payload = JSON.stringify({ type: "ai.alert", alert, at: new Date().toISOString() });
    
    for (const client of this.clients.keys()) {
      if (client.readyState === client.OPEN) {
        client.send(payload);
      }
    }
  }

  private pingClients() {
    for (const [client, state] of this.clients) {
      if (!state.isAlive) {
        client.terminate();
        this.clients.delete(client);
        continue;
      }

      state.isAlive = false;
      client.ping();
    }
  }
}
