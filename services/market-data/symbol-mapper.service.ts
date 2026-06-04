import symbolMaster from "@/data/symbol-master.sample.json";
import type { MarketExchange, MarketSegment, MarketSymbol } from "@/services/market-data/market-data.types";
import { isMainSymbolForCategory } from "@/lib/live-market-priority";
import { getDhanInstrumentMaster } from "@/services/dhan/dhanInstruments";
import {
  normalizeDhanChartInstrument,
  toDhanDisplaySegment,
  type DhanChartExchangeSegment
} from "@/services/dhan/dhanChartValidation";

type SymbolMasterRecord = MarketSymbol;

const symbols = symbolMaster as SymbolMasterRecord[];

function normalize(value: string) {
  return value.trim().toUpperCase();
}

export function getSubscriptionKey(symbol: Pick<MarketSymbol, "exchange" | "symbol">) {
  return `${symbol.exchange}:${normalize(symbol.symbol)}`;
}

export function parseSymbolInput(input: string, fallbackExchange: MarketExchange = "NSE") {
  const [maybeExchange, ...rest] = input.split(":");
  const exchange = normalize(maybeExchange) as MarketExchange;

  if ((exchange === "NSE" || exchange === "BSE" || exchange === "MCX") && rest.length > 0) {
    return {
      exchange,
      query: normalize(rest.join(":"))
    };
  }

  return {
    exchange: fallbackExchange,
    query: normalize(input)
  };
}

export function resolveMarketSymbol(input: string, fallbackExchange: MarketExchange = "NSE"): MarketSymbol | null {
  const { exchange, query } = parseSymbolInput(input, fallbackExchange);

  return (
    symbols.find((symbol) => {
      if (symbol.exchange !== exchange) {
        return false;
      }

      return [
        symbol.symbol,
        symbol.tradingSymbol,
        symbol.instrumentToken,
        symbol.bseScripCode,
        symbol.isin
      ]
        .filter(Boolean)
        .map((value) => normalize(String(value)))
        .includes(query);
    }) ?? null
  );
}

export function resolveMarketSymbols(inputs: string[], fallbackExchange: MarketExchange = "NSE") {
  const unique = new Map<string, MarketSymbol>();

  for (const input of inputs) {
    const symbol = resolveMarketSymbol(input, fallbackExchange);

    if (symbol) {
      unique.set(getSubscriptionKey(symbol), symbol);
    }
  }

  return Array.from(unique.values());
}

export function searchMarketSymbols(query: string, limit = 20) {
  const normalizedQuery = normalize(query);

  if (!normalizedQuery) {
    return symbols.slice(0, limit);
  }

  return symbols
    .filter((symbol) =>
      [
        symbol.symbol,
        symbol.tradingSymbol,
        symbol.instrumentToken,
        symbol.bseScripCode,
        symbol.isin,
        symbol.companyName
      ]
        .filter(Boolean)
        .some((value) => normalize(String(value)).includes(normalizedQuery))
    )
    .slice(0, limit);
}

// ── Dhan scrip-master backed resolution ──────────────────────────────────────
// The bundled symbol-master.sample.json only has ~32 symbols. The scanner and
// other pages reference 180+ symbols, so resolution must fall back to the full
// live Dhan instrument master (50k+ rows) to obtain the correct SecurityId.
// Indexed by `${exchange}:${NORMALIZED_NAME}` for both the display symbol and
// the trading symbol so inputs like "BAJAJ-AUTO" / "M&M" still match.

let dhanSymbolIndex: Map<string, MarketSymbol> | null = null;
let dhanSymbolIndexPromise: Promise<Map<string, MarketSymbol>> | null = null;

async function buildDhanSymbolIndex(): Promise<Map<string, MarketSymbol>> {
  const rows = await getDhanInstrumentMaster();
  const map = new Map<string, MarketSymbol>();

  for (const row of rows) {
    const seg = String(row.exchangeSegment || "");
    // Scanner/dashboard use cash equities and indices only — skip F&O,
    // currency and commodity rows so trading symbols don't collide.
    const segment = toDhanDisplaySegment(seg, row.instrument) as MarketSegment;

    const exchange: MarketExchange = row.exchange === "BSE" ? "BSE" : row.exchange === "MCX" ? "MCX" : "NSE";
    const entry: MarketSymbol = {
      exchange,
      segment,
      symbol: normalize(row.symbol),
      // The provider derives the Dhan SecurityId from instrumentToken digits,
      // so store the real numeric SecurityId here.
      instrumentToken: row.securityId,
      exchangeSegment: row.exchangeSegment,
      instrument: row.instrument ?? null,
      instrumentType: row.exchInstrumentType ?? null,
      chartInstrument: normalizeDhanChartInstrument(row.instrument, row.exchangeSegment),
      tradingSymbol: row.tradingSymbol ?? null,
      bseScripCode: exchange === "BSE" ? row.securityId : null,
      isin: row.isin ?? null,
      companyName: row.name ?? row.symbol,
      lotSize: row.lotSize ?? null,
      expiry: row.expiry ?? null,
      strikePrice: row.strikePrice ?? null,
      optionType: row.optionType === "CE" || row.optionType === "PE" ? row.optionType : null
    };

    const isMain = (() => {
      if (segment === "INDEX") return isMainSymbolForCategory("indices", entry.symbol);
      if (segment === "COMM") return isMainSymbolForCategory("commodity", entry.symbol);
      if (segment === "CURRENCY") return isMainSymbolForCategory("currency", entry.symbol);
      if (segment === "FNO") {
        const inst = `${entry.instrumentType || ""}|${entry.instrument || ""}`.toUpperCase();
        return inst.includes("OPT")
          ? isMainSymbolForCategory("options", entry.symbol)
          : isMainSymbolForCategory("futures", entry.symbol);
      }
      return exchange === "BSE"
        ? isMainSymbolForCategory("bse-eq", entry.symbol) || isMainSymbolForCategory("etf", entry.symbol)
        : isMainSymbolForCategory("nse-eq", entry.symbol) || isMainSymbolForCategory("etf", entry.symbol);
    })();
    if (!isMain) continue;

    for (const name of [row.symbol, row.tradingSymbol]) {
      if (!name) continue;
      const key = `${exchange}:${normalize(String(name))}`;
      if (!map.has(key)) map.set(key, entry);
    }
  }

  return map;
}

async function getDhanSymbolIndex(): Promise<Map<string, MarketSymbol>> {
  if (dhanSymbolIndex) return dhanSymbolIndex;
  if (!dhanSymbolIndexPromise) {
    dhanSymbolIndexPromise = buildDhanSymbolIndex()
      .then((map) => {
        dhanSymbolIndex = map;
        return map;
      })
      .catch(() => {
        // Allow a later retry if the master fetch failed.
        dhanSymbolIndexPromise = null;
        return new Map<string, MarketSymbol>();
      });
  }
  return dhanSymbolIndexPromise;
}

export async function resolveMarketSymbolAsync(
  input: string,
  fallbackExchange: MarketExchange = "NSE"
): Promise<MarketSymbol | null> {
  const direct = resolveMarketSymbol(input, fallbackExchange);
  if (direct) return direct;

  const { exchange, query } = parseSymbolInput(input, fallbackExchange);
  const index = await getDhanSymbolIndex();
  return index.get(`${exchange}:${query}`) ?? null;
}

export function getConfiguredIndexSymbols() {
  return symbols.filter((symbol) => symbol.segment === "INDEX");
}

export function getSegmentKey(symbol: Pick<MarketSymbol, "exchange" | "segment" | "exchangeSegment">): DhanChartExchangeSegment {
  if (symbol.exchangeSegment) return symbol.exchangeSegment as DhanChartExchangeSegment;
  if (symbol.segment === "INDEX") return "IDX_I";
  if (symbol.segment === "COMM") return "MCX_COMM";
  if (symbol.segment === "CURRENCY") return `${symbol.exchange}_CURRENCY` as DhanChartExchangeSegment;
  return `${symbol.exchange}_${symbol.segment}` as DhanChartExchangeSegment;
}
