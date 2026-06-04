import WebSocket from "ws";
import { logger } from "@/lib/logger";
import { resolveDhanAccessToken } from "@/services/dhan/dhanAuth";

type UpdateListener = (event: unknown) => void;

class DhanOrderUpdatesService {
  private socket?: WebSocket;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private connectPromise?: Promise<void>;
  private connected = false;
  private reconnectAttempt = 0;
  private lastError?: string;
  private nextAllowedConnectAt = 0;
  private readonly listeners = new Set<UpdateListener>();
  private readonly recentEvents: unknown[] = [];

  async connect() {
    const now = Date.now();
    if (this.connected && this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connectPromise) return this.connectPromise;
    if (now < this.nextAllowedConnectAt) return;

    this.connectPromise = this.connectInternal();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = undefined;
    }
  }

  private async connectInternal() {
    const accessToken = await resolveDhanAccessToken();
    const clientId = process.env.DHAN_CLIENT_ID?.trim();
    if (!clientId) {
      throw new Error("DHAN_CLIENT_ID is required.");
    }

    const socket = new WebSocket("wss://api-order-update.dhan.co");
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const resolveOnce = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const rejectOnce = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      socket.once("open", () => resolveOnce());
      socket.once("error", (error) => rejectOnce(error instanceof Error ? error : new Error("WebSocket error")));
      socket.once("close", () => {
        if (!settled) {
          rejectOnce(new Error("WebSocket closed before open"));
        }
      });
    });

    this.connected = true;
    this.reconnectAttempt = 0;
    this.lastError = undefined;
    socket.send(
      JSON.stringify({
        LoginReq: {
          MsgCode: 42,
          ClientId: clientId,
          Token: accessToken
        },
        UserType: "SELF"
      })
    );

    socket.on("message", (raw: import("ws").RawData) => {
      const parsed = this.safeJson(raw.toString());
      if (!parsed) return;
      this.recentEvents.push(parsed);
      if (this.recentEvents.length > 200) {
        this.recentEvents.shift();
      }
      logger.info("Dhan order update received", { eventType: (parsed as { MsgCode?: number }).MsgCode ?? "unknown" });
      for (const listener of this.listeners) {
        listener(parsed);
      }
    });

    socket.on("close", () => {
      this.connected = false;
      this.scheduleReconnect();
    });

    socket.on("error", (error: Error) => {
      this.connected = false;
      this.lastError = error.message;
      if (error.message.includes("429")) {
        this.nextAllowedConnectAt = Date.now() + 60_000;
      }
      logger.warn("Dhan order update websocket error", { message: error.message });
    });
  }

  onUpdate(listener: UpdateListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async ensureConnected() {
    if (this.connected && this.socket?.readyState === WebSocket.OPEN) return;
    await this.connect();
  }

  getStatus() {
    return {
      connected: this.connected,
      reconnectAttempt: this.reconnectAttempt,
      lastError: this.lastError ?? null,
      nextRetryAt: this.nextAllowedConnectAt || null,
      recentEvents: this.recentEvents.slice(-20)
    };
  }

  private safeJson(payload: string) {
    try {
      return JSON.parse(payload) as unknown;
    } catch {
      return null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = Math.min(20_000, 1000 * Math.max(1, 2 ** this.reconnectAttempt));
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      void this.connect().catch((error) => {
        this.lastError = error instanceof Error ? error.message : "Reconnect failed";
      });
    }, delay);
  }
}

export const dhanOrderUpdatesService = new DhanOrderUpdatesService();
