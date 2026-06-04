import symbolMaster from "@/data/symbol-master.sample.json";
import type { MarketExchange, MarketSegment, MarketSymbol } from "@/services/market-data/market-data.types";
import {
  toDhanDisplaySegment,
  type DhanChartExchangeSegment
} from "@/services/dhan/dhanChartValidation";
import {
  getSectionSymbols,
  querySymbols,
  resolveSymbol,
  type RegistrySymbol
} from "@/services/symbols/symbol-registry";

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

export function registrySymbolToMarketSymbol(row: RegistrySymbol): MarketSymbol {
  const segment = toDhanDisplaySegment(row.exchangeSegment, row.instrument) as MarketSegment;

  return {
    exchange: row.exchange,
    segment,
    symbol: normalize(row.symbol),
    instrumentToken: row.securityId,
    exchangeSegment: row.exchangeSegment,
    instrument: row.instrument,
    instrumentType: row.instrument,
    chartInstrument: row.chartInstrument,
    tradingSymbol: row.tradingSymbol,
    bseScripCode: row.exchange === "BSE" ? row.securityId : null,
    isin: row.isin,
    companyName: row.name,
    lotSize: row.lotSize,
    expiry: row.expiry,
    strikePrice: row.strikePrice,
    optionType: row.optionType === "CE" || row.optionType === "PE" ? row.optionType : null
  };
}

export async function searchMarketSymbols(query: string, limit = 20) {
  const page = await querySymbols({
    section: "all",
    query,
    limit
  });

  return page.symbols.map(registrySymbolToMarketSymbol);
}

let registrySymbolIndex: Map<string, MarketSymbol> | null = null;
let registrySymbolIndexPromise: Promise<Map<string, MarketSymbol>> | null = null;

async function buildRegistrySymbolIndex(): Promise<Map<string, MarketSymbol>> {
  const rows = (await getSectionSymbols("all")).symbols;
  const map = new Map<string, MarketSymbol>();

  for (const row of rows) {
    const entry = registrySymbolToMarketSymbol(row);
    for (const name of [row.symbol, row.tradingSymbol, row.securityId, row.isin]) {
      if (!name) continue;
      const key = `${row.exchange}:${normalize(String(name))}`;
      if (!map.has(key)) map.set(key, entry);
    }
  }

  return map;
}

async function getRegistrySymbolIndex(): Promise<Map<string, MarketSymbol>> {
  if (registrySymbolIndex) return registrySymbolIndex;
  if (!registrySymbolIndexPromise) {
    registrySymbolIndexPromise = buildRegistrySymbolIndex()
      .then((map) => {
        registrySymbolIndex = map;
        return map;
      })
      .catch(() => {
        registrySymbolIndexPromise = null;
        return new Map<string, MarketSymbol>();
      });
  }
  return registrySymbolIndexPromise;
}

export async function resolveMarketSymbolAsync(
  input: string,
  fallbackExchange: MarketExchange = "NSE"
): Promise<MarketSymbol | null> {
  const direct = resolveMarketSymbol(input, fallbackExchange);
  if (direct) return direct;

  const registryDirect = await resolveSymbol(input).catch(() => null);
  if (registryDirect) return registrySymbolToMarketSymbol(registryDirect);

  const { exchange, query } = parseSymbolInput(input, fallbackExchange);
  const index = await getRegistrySymbolIndex();
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
