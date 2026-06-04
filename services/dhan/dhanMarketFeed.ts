import WebSocket from "ws";
import { logger } from "@/lib/logger";
import { resolveDhanAccessToken } from "@/services/dhan/dhanAuth";
import { decodeDhanFeedPacket } from "@/services/dhan/dhanBinaryDecoder";
import { getDhanInstrumentMaster } from "@/services/dhan/dhanInstruments";
import { marketHistoryService } from "@/services/market-data/market-history.service";
import { DHAN_DASHBOARD_INSTRUMENTS } from "@/lib/dhan-symbols";
import { getCanonicalDisplayName, getCanonicalDisplaySymbol } from "@/lib/live-market-priority";
import type { CategoryId } from "@/lib/market-categories";

type TickListener = (tick: unknown) => void;
// Dhan v2 MarketFeed subscription codes:
//   15 = Ticker, 17 = Quote, 19 = Depth (5-level), 21 = Full (LTP+OHLC+OI+5-level depth)
type FeedRequestCode = 15 | 17 | 19 | 21;
type ExchangeSegment =
  | "IDX_I"
  | "NSE_EQ"
  | "NSE_FNO"
  | "NSE_CURRENCY"
  | "BSE_EQ"
  | "MCX_COMM"
  | "BSE_CURRENCY"
  | "BSE_FNO";
type MarketInstrument = {
  ExchangeSegment: ExchangeSegment;
  SecurityId: string;
};

function displayCategoryOf(exchangeSegment: string, instrument: string): CategoryId | null {
  const inst = instrument.toUpperCase();
  if (exchangeSegment === "MCX_COMM") return "commodity";
  if (exchangeSegment === "NSE_CURRENCY" || exchangeSegment === "BSE_CURRENCY") return "currency";
  if (inst.startsWith("OPT")) return "options";
  if (inst.startsWith("FUT")) return "futures";
  if (exchangeSegment === "IDX_I" || inst === "INDEX") return "indices";
  return null;
}

export class FeedBackoffError extends Error {
  readonly connectionId: number;
  readonly retryAt: number;

  constructor(connectionId: number, retryAt: number) {
    super(`Feed connection ${connectionId} is cooling down before reconnect.`);
    this.name = "FeedBackoffError";
    this.connectionId = connectionId;
    this.retryAt = retryAt;
  }
}

export const isFeedBackoffError = (error: unknown): error is FeedBackoffError =>
  error instanceof FeedBackoffError;

// Dhan v2 published limits:
//   - up to 5 concurrent websocket connections per user
//   - up to 5000 instruments per connection
//   - up to 100 instruments per subscribe message
const INSTRUMENTS_PER_CONNECTION = 5000;
const BATCH_SIZE = 100;
const MAX_CONCURRENT_CONNECTIONS = 5;

const exchangeSegmentFromCode: Record<number, ExchangeSegment> = {
  0: "IDX_I",
  1: "NSE_EQ",
  2: "NSE_FNO",
  3: "NSE_CURRENCY",
  4: "BSE_EQ",
  5: "MCX_COMM",
  7: "BSE_CURRENCY",
  8: "BSE_FNO"
};

// Manages a single WebSocket connection to the Dhan feed endpoint.
class FeedConnection {
  readonly id: number;
  private socket?: WebSocket;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private watchdogTimer?: ReturnType<typeof setInterval>;
  private keepaliveTimer?: ReturnType<typeof setInterval>;
  private connectPromise?: Promise<void>;
  private connected = false;
  private reconnectAttempt = 0;
  lastError?: string;
  private nextAllowedConnectAt = 0;
  private lastFeedActivityAt = 0;
  readonly subscriptions = new Map<FeedRequestCode, Map<string, MarketInstrument>>();

  private readonly emitTick: (tick: unknown) => void;
  private readonly pushLatest: (tick: unknown) => void;

  constructor(id: number, emitTick: (tick: unknown) => void, pushLatest: (tick: unknown) => void) {
    this.id = id;
    this.emitTick = emitTick;
    this.pushLatest = pushLatest;
  }

  isConnected() {
    return this.connected && this.socket?.readyState === WebSocket.OPEN;
  }

  totalSubscribed() {
    return Array.from(this.subscriptions.values()).reduce((acc, m) => acc + m.size, 0);
  }

  hasCapacity(count = 1) {
    return this.totalSubscribed() + count <= INSTRUMENTS_PER_CONNECTION;
  }

  async connect() {
    const now = Date.now();
    if (this.isConnected()) return;
    if (this.connectPromise) return this.connectPromise;
    if (now < this.nextAllowedConnectAt) {
      this.scheduleReconnect(this.nextAllowedConnectAt - now);
      throw new FeedBackoffError(this.id, this.nextAllowedConnectAt);
    }
    this.connectPromise = this.doConnect();
    try {
      await this.connectPromise;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "Connect failed";
      // Dhan throttles the WS handshake itself with HTTP 429 when connection
      // attempts are too frequent (or > allowed concurrent sockets). Hammering
      // it every few seconds keeps it 429-ing forever, so respect a real
      // cool-off for 429 specifically. Normal drops still fast-reconnect.
      const is429 = /\b429\b/.test(this.lastError);
      const coolOff = is429 ? Number(process.env.DHAN_WS_429_BACKOFF_MS || "45000") : 0;
      if (coolOff > 0) {
        this.nextAllowedConnectAt = Date.now() + coolOff;
        this.scheduleReconnect(coolOff);
      } else {
        this.scheduleReconnect();
      }
      throw error;
    } finally {
      this.connectPromise = undefined;
    }
  }

  private async doConnect() {
    const token = await resolveDhanAccessToken();
    const clientId = process.env.DHAN_CLIENT_ID?.trim();
    if (!clientId) throw new Error("DHAN_CLIENT_ID is required.");

    const baseUrl = process.env.DHAN_WS_URL || "wss://api-feed.dhan.co";
    const url = `${baseUrl}?version=2&token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}&authType=2`;

    this.stopWatchdog();
    this.socket?.removeAllListeners();
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) this.socket.terminate();

    const socket = new WebSocket(url, {
      handshakeTimeout: Number(process.env.DHAN_WS_HANDSHAKE_TIMEOUT_MS || "15000")
    });
    this.socket = socket;
    this.lastFeedActivityAt = Date.now();

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const resolveOnce = () => {
        if (!settled) { settled = true; resolve(); }
      };
      const rejectOnce = (e: Error) => {
        if (!settled) { settled = true; reject(e); }
      };

      const timeout = setTimeout(() => {
        rejectOnce(new Error(`Feed ${this.id} handshake timed out`));
        socket.terminate();
      }, Number(process.env.DHAN_WS_HANDSHAKE_TIMEOUT_MS || "15000"));

      socket.once("open", () => { clearTimeout(timeout); resolveOnce(); });
      socket.once("error", (e) => {
        clearTimeout(timeout);
        rejectOnce(e instanceof Error ? e : new Error("WebSocket error"));
      });
      socket.once("close", () => {
        clearTimeout(timeout);
        if (!settled) rejectOnce(new Error("WebSocket closed before open"));
      });
    });

    this.connected = true;
    this.reconnectAttempt = 0;
    this.nextAllowedConnectAt = 0;
    this.lastError = undefined;
    logger.info(`Dhan feed connection ${this.id} connected`);
    this.startWatchdog(socket);
    this.startKeepalive(socket);

    void this.resubscribeAll().catch((e) => {
      this.lastError = e instanceof Error ? e.message : "Resubscribe failed";
    });

    socket.on("message", (raw: import("ws").RawData) => {
      this.lastFeedActivityAt = Date.now();
      const parsed = this.normalizePacket(raw);
      if (!parsed) return;
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "type" in parsed &&
        (parsed as { type?: string }).type === "disconnect"
      ) {
        this.lastError = `Feed ${this.id} disconnected (code: ${(parsed as { reasonCode?: number }).reasonCode ?? "unknown"})`;
        socket.close();
        return;
      }
      // Enrich the packet with symbol metadata from the server-side registry
      // so SSE consumers don't need a client-side SecurityId → symbol map.
      const enriched = this.enrichWithSymbol(parsed);
      marketHistoryService.trackDhanPacket(enriched);
      this.pushLatest(enriched);
      this.emitTick(enriched);
    });

    socket.on("close", () => {
      this.connected = false;
      this.stopWatchdog();
      this.stopKeepalive();
      this.scheduleReconnect();
    });

    socket.on("error", (e: Error) => {
      this.lastError = e.message;
      this.connected = false;
      // Unlimited API plan: do not impose a long cool-off on transient
      // errors. A brief 3s backoff is enough to avoid a tight crash loop.
      if (e.message.includes("429")) this.nextAllowedConnectAt = Date.now() + 3_000;
      logger.warn(`Dhan feed ${this.id} error`, { message: e.message });
    });

    socket.on("ping", () => { this.lastFeedActivityAt = Date.now(); });
    socket.on("pong", () => { this.lastFeedActivityAt = Date.now(); });
  }

  async subscribe(instruments: MarketInstrument[], requestCode: FeedRequestCode) {
    await this.ensureConnected();
    this.track(instruments, requestCode);
    await this.sendBatches(instruments, requestCode);
  }

  async disconnect() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined; }
    this.stopWatchdog();
    this.stopKeepalive();
    this.connected = false;
    this.connectPromise = undefined;
    const socket = this.socket;
    this.socket = undefined;
    if (!socket) return;
    socket.removeAllListeners("close");
    socket.removeAllListeners("error");
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ RequestCode: 12 }), () => socket.close());
    } else if (socket.readyState === WebSocket.CONNECTING) {
      socket.terminate();
    }
  }

  async ensureConnected() {
    if (!this.isConnected()) await this.connect();
  }

  private track(instruments: MarketInstrument[], requestCode: FeedRequestCode) {
    const map = this.subscriptions.get(requestCode) ?? new Map<string, MarketInstrument>();
    for (const inst of instruments) {
      map.set(`${inst.ExchangeSegment}:${inst.SecurityId}`, inst);
    }
    this.subscriptions.set(requestCode, map);
  }

  private async resubscribeAll() {
    for (const [code, map] of this.subscriptions) {
      const instruments = Array.from(map.values());
      if (instruments.length) await this.sendBatches(instruments, code);
    }
  }

  private async sendBatches(instruments: MarketInstrument[], requestCode: FeedRequestCode) {
    for (let i = 0; i < instruments.length; i += BATCH_SIZE) {
      const batch = instruments.slice(i, i + BATCH_SIZE);
      await this.sendJson({
        RequestCode: requestCode,
        InstrumentCount: batch.length,
        InstrumentList: batch
      });
    }
  }

  private async sendJson(payload: unknown) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error(`Feed connection ${this.id} is not open.`);
    }
    await new Promise<void>((resolve, reject) => {
      this.socket?.send(JSON.stringify(payload), (e) => (e ? reject(e) : resolve()));
    });
  }

  private normalizePacket(raw: import("ws").RawData) {
    if (typeof raw === "string") {
      try { return JSON.parse(raw) as unknown; } catch { return { type: "dhan.text", payload: raw }; }
    }
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
    if (buf.length === 0) return null;
    return { ...decodeDhanFeedPacket(buf), receivedAt: new Date().toISOString() };
  }

  /**
   * Enrich a decoded packet with the human-readable symbol name and exchange
   * info from the server-side symbol registry. This is called before the packet
   * is emitted so that SSE consumers receive a self-contained tick with no
   * further lookup needed on the browser side.
   */
  private enrichWithSymbol(packet: unknown): unknown {
    if (!packet || typeof packet !== "object") return packet;
    const p = packet as Record<string, unknown>;
    const securityId = typeof p.securityId === "string" ? p.securityId : null;
    if (!securityId) return packet;
    const info = this.resolveSymbolFromRegistry(securityId);
    if (!info) return packet;
    return {
      ...p,
      symbol: info.symbol,
      exchange: info.exchange,
      segment: info.segment,
      exchangeSegment: info.exchangeSegment,
      name: info.name ?? info.symbol
    };
  }

  // Forward the lookup to the parent service's symbol registry.
  // This is set by DhanMarketFeedService after construction.
  resolveSymbolFromRegistry: (securityId: string) => { symbol: string; exchange: string; segment: string; exchangeSegment: string; name?: string } | null = () => null;

  private startWatchdog(socket: WebSocket) {
    this.stopWatchdog();
    // Dhan sends a server ping every ~10s and closes the socket after 40s
    // of client silence. Detect a dead feed well before that (default 20s
    // ≈ two missed pings) and force a fast reconnect so data never stalls.
    const timeoutMs = Number(process.env.DHAN_WS_STALE_TIMEOUT_MS || "20000");
    this.watchdogTimer = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastFeedActivityAt > timeoutMs) {
        this.lastError = `Feed ${this.id} stale; reconnecting.`;
        socket.terminate();
      }
    }, 5_000);
  }

  private stopWatchdog() {
    if (this.watchdogTimer) { clearInterval(this.watchdogTimer); this.watchdogTimer = undefined; }
  }

  // Proactively ping the Dhan feed so NAT/proxies keep the socket alive
  // and a half-open connection is detected quickly, independent of the
  // server-side ping cadence.
  private startKeepalive(socket: WebSocket) {
    this.stopKeepalive();
    const intervalMs = Number(process.env.DHAN_WS_KEEPALIVE_MS || "10000");
    this.keepaliveTimer = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return;
      try {
        socket.ping();
      } catch {
        socket.terminate();
      }
    }, intervalMs);
  }

  private stopKeepalive() {
    if (this.keepaliveTimer) { clearInterval(this.keepaliveTimer); this.keepaliveTimer = undefined; }
  }

  private scheduleReconnect(forcedDelay?: number) {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    // Tight, capped backoff (max 4s) so the feed recovers almost
    // immediately after any drop. Reconnection retries forever.
    const delay = forcedDelay ?? Math.min(4_000, 500 * Math.max(1, 2 ** Math.min(this.reconnectAttempt, 3)));
    this.reconnectAttempt += 1;
    this.nextAllowedConnectAt = Date.now() + delay;
    this.reconnectTimer = setTimeout(() => {
      void this.connect().catch((e) => {
        if (isFeedBackoffError(e)) return;
        this.lastError = e instanceof Error ? e.message : "Reconnect failed";
      });
    }, delay);
  }

  getReconnectAttempt() {
    return this.reconnectAttempt;
  }

  getNextRetryAt() {
    return this.nextAllowedConnectAt || null;
  }
}

// Pool of FeedConnections. Each connection handles up to INSTRUMENTS_PER_CONNECTION
// instruments. Additional connections are created automatically when capacity is exceeded,
// allowing full NSE + BSE market coverage across multiple WebSocket sessions.
class DhanMarketFeedService {
  private connections: FeedConnection[] = [];
  private readonly listeners = new Set<TickListener>();
  /**
   * Latest tick per securityId — O(1) dedup/lookup.
   * Replaces the old latestTicks array (which had O(n) shift() and no dedup).
   */
  private readonly latestTicksMap = new Map<string, unknown>();
  private autoSubscribed = false;
  private nextConnectionId = 0;

  /**
   * Server-side symbol registry: Dhan SecurityId → { symbol, exchange, segment, exchangeSegment }
   * Built from all subscribed instruments so SSE packets can be enriched with the
   * human-readable symbol name before being sent to the browser. The browser
   * receives a complete tick without needing DHAN_SYMBOL_BY_SECURITY_ID lookups.
   */
  private readonly symbolRegistry = new Map<string, {
    symbol: string;
    exchange: string;
    segment: string;
    exchangeSegment: string;
    name?: string;
  }>();

  /** Register an instrument in the symbol registry (securityId → metadata). */
  registerSymbol(securityId: string, info: {
    symbol: string;
    exchange: string;
    segment: string;
    exchangeSegment: string;
    name?: string;
  }) {
    this.symbolRegistry.set(securityId, info);
  }

  /** Look up a securityId in the symbol registry. */
  resolveSymbol(securityId: string) {
    return this.symbolRegistry.get(securityId) ?? null;
  }

  /**
   * Return a snapshot of the latest tick for every subscribed instrument.
   * Used by the SSE stream to give new connections an instant price snapshot
   * without waiting for the next Dhan WebSocket message.
   */
  getSnapshot(): unknown[] {
    return Array.from(this.latestTicksMap.values());
  }

  async connect() {
    await this.ensurePrimaryConnection();
    void this.subscribeAutoConfiguredInstruments().catch((e) => {
      logger.warn("Auto-subscribe failed", { message: e instanceof Error ? e.message : String(e) });
    });
  }

  async subscribe(instruments: unknown[], requestCode: FeedRequestCode = 15) {
    if (!Array.isArray(instruments) || instruments.length === 0) {
      throw new Error("instruments are required.");
    }
    const normalized = this.normalizeInstruments(instruments);
    // Register any new instruments in the symbol registry using DHAN_DASHBOARD_INSTRUMENTS as source.
    for (const inst of normalized) {
      if (!this.symbolRegistry.has(inst.SecurityId)) {
        const known = DHAN_DASHBOARD_INSTRUMENTS.find((d) => d.SecurityId === inst.SecurityId);
        if (known) {
          this.symbolRegistry.set(inst.SecurityId, {
            symbol: known.symbol,
            exchange: known.exchange,
            segment: known.segment,
            exchangeSegment: known.ExchangeSegment,
            name: known.name
          });
        }
      }
    }
    await this.distribute(normalized, requestCode);
  }

  async disconnect() {
    await Promise.all(this.connections.map((c) => c.disconnect()));
    this.connections = [];
    this.autoSubscribed = false;
  }

  async ensureConnected() {
    await this.ensurePrimaryConnection();
  }

  onTick(listener: TickListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStatus() {
    const total = this.connections.reduce((acc, c) => acc + c.totalSubscribed(), 0);
    const reconnectAttempt = this.connections.reduce((max, c) => Math.max(max, c.getReconnectAttempt()), 0);
    const nextRetryCandidates = this.connections
      .map((c) => c.getNextRetryAt())
      .filter((v): v is number => typeof v === "number" && v > Date.now());
    const nextRetryAt = nextRetryCandidates.length > 0 ? Math.min(...nextRetryCandidates) : null;
    return {
      connected: this.connections.some((c) => c.isConnected()),
      connections: this.connections.length,
      totalSubscribed: total,
      reconnectAttempt,
      lastError: this.connections.find((c) => c.lastError)?.lastError ?? null,
      nextRetryAt,
      cachedTicks: Array.from(this.latestTicksMap.values()).slice(-20),
      perConnection: this.connections.map((c) => ({
        id: c.id,
        connected: c.isConnected(),
        subscribed: c.totalSubscribed(),
        reconnectAttempt: c.getReconnectAttempt(),
        nextRetryAt: c.getNextRetryAt(),
        lastError: c.lastError ?? null
      }))
    };
  }

  private async ensurePrimaryConnection() {
    if (this.connections.length === 0) {
      const conn = this.spawnConnection();
      await conn.connect();
    } else {
      await this.connections[0].ensureConnected();
    }
  }

  private spawnConnection() {
    const id = this.nextConnectionId++;
    const conn = new FeedConnection(
      id,
      (tick) => { for (const l of this.listeners) l(tick); },
      (tick) => {
        // O(1) dedup: latest tick per securityId replaces previous.
        const t = tick as Record<string, unknown>;
        const sid = typeof t.securityId === "string" ? t.securityId : null;
        if (sid) this.latestTicksMap.set(sid, tick);
      }
    );
    // Wire the server-side symbol registry resolver into the connection so
    // packets are enriched with human-readable symbol names before emission.
    conn.resolveSymbolFromRegistry = (securityId) => this.symbolRegistry.get(securityId) ?? null;
    this.connections.push(conn);
    return conn;
  }

  private async distribute(instruments: MarketInstrument[], requestCode: FeedRequestCode) {
    let offset = 0;
    while (offset < instruments.length) {
      let conn = this.connections.find((c) => c.hasCapacity(1));
      if (!conn) {
        // Dhan caps users at 5 concurrent live-feed websockets. Once we hit that
        // ceiling we cannot spawn another connection — packing the remainder
        // into the least-loaded existing socket is the only safe option (and
        // will eventually exceed the per-connection 5000 cap, which Dhan will
        // reject; surface that explicitly so callers can react rather than
        // silently dropping the subscription).
        if (this.connections.length >= MAX_CONCURRENT_CONNECTIONS) {
          const remaining = instruments.length - offset;
          logger.error(
            `Cannot subscribe ${remaining} more instrument(s): reached Dhan's 5 concurrent websocket cap and all ${this.connections.length} connections are full (${INSTRUMENTS_PER_CONNECTION} each = ${MAX_CONCURRENT_CONNECTIONS * INSTRUMENTS_PER_CONNECTION} max).`
          );
          throw new Error(
            `Dhan live-feed capacity exhausted: ${MAX_CONCURRENT_CONNECTIONS} sockets × ${INSTRUMENTS_PER_CONNECTION} instruments = ${MAX_CONCURRENT_CONNECTIONS * INSTRUMENTS_PER_CONNECTION} max, attempted to add ${remaining} more.`
          );
        }
        conn = this.spawnConnection();
        await conn.connect();
      }
      const capacity = INSTRUMENTS_PER_CONNECTION - conn.totalSubscribed();
      const slice = instruments.slice(offset, offset + capacity);
      await conn.subscribe(slice, requestCode);
      offset += slice.length;
    }
  }

  private normalizeInstruments(instruments: unknown[]): MarketInstrument[] {
    const parsed: MarketInstrument[] = [];
    for (const inst of instruments) {
      if (inst && typeof inst === "object" && "ExchangeSegment" in inst && "SecurityId" in inst) {
        const obj = inst as { ExchangeSegment: unknown; SecurityId: unknown };
        if (typeof obj.ExchangeSegment === "string" && typeof obj.SecurityId === "string" && obj.SecurityId.trim()) {
          parsed.push({ ExchangeSegment: obj.ExchangeSegment as ExchangeSegment, SecurityId: obj.SecurityId.trim() });
          continue;
        }
      }
      if (Array.isArray(inst) && inst.length >= 2) {
        const [code, sid] = inst;
        if (typeof code === "number" && typeof sid === "string" && sid.trim()) {
          parsed.push({ ExchangeSegment: exchangeSegmentFromCode[code] ?? "NSE_EQ", SecurityId: sid.trim() });
          continue;
        }
      }
      throw new Error("Invalid instrument format. Use { ExchangeSegment, SecurityId } or [exchangeCode, securityId].");
    }
    return parsed;
  }

  private async subscribeAutoConfiguredInstruments() {
    if (this.autoSubscribed) return;
    this.autoSubscribed = true;

    // -----------------------------------------------------------------------
    // Step 1: Always subscribe the curated DHAN_DASHBOARD_INSTRUMENTS list.
    // This gives immediate live ticks for the ~90 well-known Indian symbols
    // (indices + Nifty 50 + popular stocks + ETFs) without any segment-wide
    // overload. Register each in the server-side symbol registry so outgoing
    // SSE events carry the symbol name and don't require a browser-side map.
    // -----------------------------------------------------------------------
    const curatedIndices = DHAN_DASHBOARD_INSTRUMENTS.filter((i) => i.segment === "INDEX");
    const curatedEquities = DHAN_DASHBOARD_INSTRUMENTS.filter((i) => i.segment !== "INDEX");

    // Register all curated instruments in the server-side symbol registry.
    for (const inst of DHAN_DASHBOARD_INSTRUMENTS) {
      this.symbolRegistry.set(inst.SecurityId, {
        symbol: inst.symbol,
        exchange: inst.exchange,
        segment: inst.segment,
        exchangeSegment: inst.ExchangeSegment,
        name: inst.name
      });
    }

    if (curatedIndices.length > 0) {
      const indexInstruments: MarketInstrument[] = curatedIndices.map((i) => ({
        ExchangeSegment: i.ExchangeSegment as ExchangeSegment,
        SecurityId: i.SecurityId
      }));
      logger.info(`Auto-subscribing ${indexInstruments.length} curated index instruments (requestCode 15)`);
      await this.distribute(indexInstruments, 15);
    }

    if (curatedEquities.length > 0) {
      const equityInstruments: MarketInstrument[] = curatedEquities.map((i) => ({
        ExchangeSegment: i.ExchangeSegment as ExchangeSegment,
        SecurityId: i.SecurityId
      }));
      logger.info(`Auto-subscribing ${equityInstruments.length} curated equity/ETF instruments (requestCode 17)`);
      await this.distribute(equityInstruments, 17);
    }

    // -----------------------------------------------------------------------
    // Step 2: Additional full-segment subscriptions from env var.
    // DHAN_AUTO_SUBSCRIBE_SEGMENTS is now set to "IDX_I" only in .env —
    // indices are already covered by step 1 so this is effectively a no-op
    // for the default config. Only used for special deployments that
    // deliberately opt into broader segment coverage.
    // -----------------------------------------------------------------------
    const segmentsRaw = process.env.DHAN_AUTO_SUBSCRIBE_SEGMENTS?.trim();
    if (segmentsRaw) {
      const segments = segmentsRaw.split(",").map((s) => s.trim()).filter(Boolean) as ExchangeSegment[];
      const requestCode = Number(process.env.DHAN_AUTO_SUBSCRIBE_REQUEST_CODE || "15") as FeedRequestCode;
      // Skip segments already covered by the curated list above.
      const alreadyCovered = new Set(DHAN_DASHBOARD_INSTRUMENTS.map((i) => i.ExchangeSegment));
      const extraSegments = segments.filter((seg) => !alreadyCovered.has(seg));

      if (extraSegments.length > 0) {
        logger.info("Auto-subscribing additional segment instruments", { extraSegments });
        const master = await getDhanInstrumentMaster();
        const instruments: MarketInstrument[] = master
          .filter((inst) => extraSegments.includes(inst.exchangeSegment as ExchangeSegment))
          .map((inst) => {
            const displayCategory = displayCategoryOf(inst.exchangeSegment, inst.instrument);
            const rawSymbol = inst.symbol || inst.tradingSymbol;
            // Match live-market-universe.buildRow display rules so the SSE
            // tick.symbol matches the table row.symbol for the same instrument.
            // Indices must NOT prefix-collapse ("NIFTYBANK" stays "NIFTYBANK")
            // or two distinct indices both render as "NIFTY" in the UI.
            const displaySymbol = displayCategory && displayCategory !== "indices"
              ? getCanonicalDisplaySymbol(displayCategory, rawSymbol)
              : rawSymbol;
            const displayName = displayCategory && displayCategory !== "indices"
              ? getCanonicalDisplayName(displayCategory, rawSymbol, inst.name || inst.tradingSymbol)
              : inst.name || inst.tradingSymbol;
            // Register in symbol registry as we go
            this.symbolRegistry.set(inst.securityId, {
              symbol: displaySymbol,
              exchange: inst.exchange as string,
              segment: inst.segment,
              exchangeSegment: inst.exchangeSegment,
              name: displayName
            });
            return { ExchangeSegment: inst.exchangeSegment as ExchangeSegment, SecurityId: inst.securityId };
          });
        logger.info(`Subscribing ${instruments.length} additional segment instruments across ${Math.ceil(instruments.length / INSTRUMENTS_PER_CONNECTION)} connection(s)`, { extraSegments });
        if (instruments.length > 0) {
          await this.distribute(instruments, requestCode);
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step 3: JSON-based custom overrides (additive).
    // -----------------------------------------------------------------------
    const raw = process.env.DHAN_AUTO_SUBSCRIBE_JSON?.trim();
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown[];
        const normalized = this.normalizeInstruments(parsed);
        if (normalized.length) {
          await this.distribute(normalized, 15);
        }
      } catch {
        logger.warn("Invalid DHAN_AUTO_SUBSCRIBE_JSON; skipping custom auto-subscribe");
      }
    }
  }
}

export const dhanMarketFeedService = new DhanMarketFeedService();
