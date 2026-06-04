import { cacheGetOrSet } from "@/lib/cache";

export type DhanInstrumentSearchResult = {
  symbol: string;
  tradingSymbol: string;
  name: string;
  exchange: "NSE" | "BSE" | "MCX";
  segment: string;
  exchangeSegment: string;
  securityId: string;
  instrument: string;
  isin?: string | null;
  lotSize?: number | null;
  expiry?: string | null;
  strikePrice?: number | null;
  optionType?: string | null;
  // Series code (EQ, BE, BZ, T, SM, ST, …). Drives tradeability filters —
  // EQ is the normal NSE rolling-settlement segment; BE/BZ/T are
  // trade-to-trade / surveillance segments most strategies should avoid.
  series?: string | null;
  // Expiry flag from the master. "M" = monthly, "W" = weekly, "Q" = quarterly.
  // Combined with the expiry date this tells us whether a derivative row is
  // still live or already expired.
  expiryFlag?: string | null;
  // Exchange instrument type — the REAL discriminator. ES=Equity Stock,
  // IDX=Index, ETF, FUTSTK/FUTIDX/FUTCOM/FUTCUR, OPTSTK/OPTIDX/OPTCUR/OPTCOM/OPTFUT,
  // DBT/DEB/SGB=Debt instruments mis-classified by SEM_INSTRUMENT_NAME.
  exchInstrumentType?: string | null;
};

const DHAN_COMPACT_MASTER_URL =
  process.env.DHAN_SCRIP_MASTER_URL || "https://images.dhan.co/api-data/api-scrip-master.csv";

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function normalizeHeader(value: string) {
  return value.trim().toUpperCase();
}

function firstValue(row: Record<string, string>, aliases: string[]) {
  for (const alias of aliases) {
    const value = row[alias];
    if (value !== undefined && value !== "") return value;
  }
  return "";
}

function toExchangeSegment(exchange: string, segment: string) {
  const ex = exchange.toUpperCase();
  const seg = segment.toUpperCase().trim();
  // Dhan's master uses single-letter SEM_SEGMENT codes — handle those first.
  // E = Equity, D = Derivatives, I = Index, C = Currency, M = Commodity.
  if (seg === "I") return "IDX_I";
  if (seg === "D") return `${ex}_FNO`;
  if (seg === "C") return ex === "MCX" ? "MCX_COMM" : `${ex}_CURRENCY`;
  if (seg === "M") return "MCX_COMM";
  if (seg === "E") return ex === "MCX" ? "MCX_COMM" : `${ex}_EQ`;
  // Fall back to substring matching for any other format the master might emit.
  if (seg.includes("FNO") || seg.includes("DERIVATIVE")) return `${ex}_FNO`;
  if (seg.includes("COMM") || ex === "MCX") return "MCX_COMM";
  if (seg.includes("CUR")) return `${ex}_CURRENCY`;
  if (seg.includes("IDX") || seg.includes("INDEX")) return "IDX_I";
  return `${ex}_EQ`;
}

function parseMaster(csv: string): DhanInstrumentSearchResult[] {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0] ?? "").map(normalizeHeader);

  return lines.slice(1).flatMap((line) => {
    const cells = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
    const exchange = firstValue(row, ["SEM_EXM_EXCH_ID", "EXCH_ID", "EXCHANGE"]).toUpperCase();
    const segment = firstValue(row, ["SEM_SEGMENT", "SEGMENT", "EXCHANGE_SEGMENT"]).toUpperCase();
    const securityId = firstValue(row, ["SEM_SMST_SECURITY_ID", "SECURITY_ID", "SECURITYID"]);
    const tradingSymbol = firstValue(row, ["SEM_TRADING_SYMBOL", "TRADING_SYMBOL", "SYMBOL_NAME"]);
    const customSymbol = firstValue(row, ["SEM_CUSTOM_SYMBOL", "CUSTOM_SYMBOL", "SYMBOL", "UNDERLYING_SYMBOL"]);
    const instrumentRaw = firstValue(row, ["SEM_INSTRUMENT_NAME", "INSTRUMENT", "INSTRUMENT_NAME"]) || "EQUITY";
    const isDerivative = instrumentRaw.toUpperCase().startsWith("FUT") || instrumentRaw.toUpperCase().startsWith("OPT");

    if (!exchange || !securityId || !tradingSymbol) return [];

    // For equities and indices, the trading symbol is the canonical short
    // name traders use ("RELIANCE", "NIFTY", "SENSEX"). The custom symbol
    // is usually the long display name ("Reliance Industries", "Nifty 50") —
    // not what someone types into a search box. For derivatives, the custom
    // symbol encodes expiry/strike ("RELIANCE MAY FUT") so we keep it.
    const canonical = isDerivative ? (customSymbol || tradingSymbol) : tradingSymbol;

    return [
      {
        symbol: canonical.replace(/\s+/g, "").toUpperCase(),
        tradingSymbol,
        name: customSymbol || firstValue(row, ["SM_SYMBOL_NAME", "NAME"]) || tradingSymbol,
        exchange: exchange === "BSE" ? "BSE" : exchange === "MCX" ? "MCX" : "NSE",
        segment,
        exchangeSegment: firstValue(row, ["EXCHANGE_SEGMENT"]) || toExchangeSegment(exchange, segment),
        securityId,
        instrument: instrumentRaw,
        isin: firstValue(row, ["SEM_ISIN_CODE", "ISIN"]) || null,
        lotSize: Number(firstValue(row, ["SEM_LOT_UNITS", "LOT_SIZE"])) || null,
        expiry: firstValue(row, ["SEM_EXPIRY_DATE", "EXPIRY_DATE"]) || null,
        strikePrice: Number(firstValue(row, ["SEM_STRIKE_PRICE", "STRIKE_PRICE"])) || null,
        optionType: firstValue(row, ["SEM_OPTION_TYPE", "OPTION_TYPE"]) || null,
        series: firstValue(row, ["SEM_SERIES", "SERIES"]) || null,
        expiryFlag: firstValue(row, ["SEM_EXPIRY_FLAG", "EXPIRY_FLAG"]) || null,
        exchInstrumentType: firstValue(row, ["SEM_EXCH_INSTRUMENT_TYPE", "EXCH_INSTRUMENT_TYPE"]) || null
      }
    ];
  });
}

// Reliability: a single failed fetch used to take the entire registry offline
// for 6 h. Now we (1) retry the fetch with exponential backoff before giving
// up, and (2) keep a process-local "last known good" copy so subsequent calls
// can serve stale data instead of throwing while Dhan is unreachable.
let lastKnownGoodMaster: DhanInstrumentSearchResult[] | null = null;
let lastKnownGoodAt = 0;

async function fetchMasterWithRetry(): Promise<DhanInstrumentSearchResult[]> {
  const attempts = Math.max(1, Number(process.env.DHAN_MASTER_RETRIES || "3"));
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(DHAN_COMPACT_MASTER_URL, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Dhan master fetch ${response.status}`);
      }
      const parsed = parseMaster(await response.text());
      if (parsed.length === 0) {
        throw new Error("Dhan master returned 0 rows (likely truncated response)");
      }
      lastKnownGoodMaster = parsed;
      lastKnownGoodAt = Date.now();
      return parsed;
    } catch (e) {
      lastError = e;
      // Exponential backoff between attempts (200ms, 400ms, 800ms…).
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 200 * 2 ** i));
    }
  }
  // All retries failed. If we have a prior good copy, serve it stale rather
  // than letting every downstream caller error. The Redis TTL means we'll
  // retry the live fetch on the next cache miss.
  if (lastKnownGoodMaster && lastKnownGoodMaster.length > 0) {
    return lastKnownGoodMaster;
  }
  throw lastError instanceof Error ? lastError : new Error("Dhan master fetch failed");
}

export async function getDhanInstrumentMaster() {
  return cacheGetOrSet("dhan:instrument-master:v1", 60 * 60 * 6, fetchMasterWithRetry);
}

/** Diagnostics: when did we last successfully refresh the live master? */
export function getMasterFreshness(): { fetchedAt: number | null; rowCount: number } {
  return {
    fetchedAt: lastKnownGoodAt || null,
    rowCount: lastKnownGoodMaster?.length ?? 0
  };
}

export async function searchDhanInstruments(query: string, limit = 30) {
  const normalized = query.trim().toUpperCase();
  const instruments = await getDhanInstrumentMaster();

  if (!normalized) {
    return instruments.slice(0, limit);
  }

  return instruments
    .filter((instrument) =>
      [
        instrument.symbol,
        instrument.tradingSymbol,
        instrument.name,
        instrument.securityId,
        instrument.isin,
        instrument.exchangeSegment
      ]
        .filter(Boolean)
        .some((value) => String(value).toUpperCase().includes(normalized))
    )
    .slice(0, limit);
}
