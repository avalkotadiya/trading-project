import { DhanError } from "@/services/dhan/dhanClient";

export const DHAN_CHART_EXCHANGE_SEGMENTS = [
  "NSE_EQ",
  "NSE_FNO",
  "NSE_CURRENCY",
  "BSE_EQ",
  "BSE_FNO",
  "BSE_CURRENCY",
  "MCX_COMM",
  "IDX_I"
] as const;

export const DHAN_CHART_INSTRUMENTS = [
  "EQUITY",
  "INDEX",
  "FUTIDX",
  "OPTIDX",
  "FUTSTK",
  "OPTSTK",
  "FUTCOM",
  "OPTFUT",
  "FUTCUR",
  "OPTCUR"
] as const;

export const DHAN_CHART_INTERVALS = ["1", "5", "15", "25", "60"] as const;

export type DhanChartExchangeSegment = (typeof DHAN_CHART_EXCHANGE_SEGMENTS)[number];
export type DhanChartInstrument = (typeof DHAN_CHART_INSTRUMENTS)[number];
export type DhanChartInterval = (typeof DHAN_CHART_INTERVALS)[number];

const CHART_SEGMENTS = new Set<string>(DHAN_CHART_EXCHANGE_SEGMENTS);
const CHART_INSTRUMENTS = new Set<string>(DHAN_CHART_INSTRUMENTS);
const CHART_INTERVALS = new Set<string>(DHAN_CHART_INTERVALS);

export type DhanChartRequestInput = {
  securityId: string;
  exchangeSegment?: string;
  instrument?: string;
  interval?: string;
  fromDate: string;
  toDate: string;
  expiryCode?: number;
  oi?: boolean;
};

export type NormalizedDhanChartRequest = {
  securityId: string;
  exchangeSegment: DhanChartExchangeSegment;
  instrument: DhanChartInstrument;
  interval?: DhanChartInterval;
  fromDate: string;
  toDate: string;
  expiryCode: number;
  oi: boolean;
};

export function normalizeDhanChartInstrument(input?: string, exchangeSegment?: string): DhanChartInstrument {
  const raw = (input || "EQUITY").trim().toUpperCase();
  const segment = (exchangeSegment || "").trim().toUpperCase();
  if (raw === "EQ" || raw === "ES" || raw === "ETF") return "EQUITY";
  if (raw === "IDX") return "INDEX";
  if (raw === "OPTCOM") return "OPTFUT";
  if (raw === "FUT" || raw === "FUTURE" || raw === "FUTURES") {
    if (segment === "MCX_COMM") return "FUTCOM";
    if (segment.endsWith("_CURRENCY")) return "FUTCUR";
    if (segment === "IDX_I") return "FUTIDX";
    return "FUTSTK";
  }
  if (raw === "OPT" || raw === "OPTION" || raw === "OPTIONS") {
    if (segment === "MCX_COMM") return "OPTFUT";
    if (segment.endsWith("_CURRENCY")) return "OPTCUR";
    if (segment === "IDX_I") return "OPTIDX";
    return "OPTSTK";
  }
  if (CHART_INSTRUMENTS.has(raw)) return raw as DhanChartInstrument;
  throw new DhanError(
    `Dhan chart instrument '${input || ""}' is not supported.`,
    400,
    "DHAN_INVALID_HISTORY_REQUEST",
    { field: "instrument", value: input, allowed: DHAN_CHART_INSTRUMENTS }
  );
}

function normalizeDhanChartSegment(input?: string): DhanChartExchangeSegment {
  const raw = (input || "NSE_EQ").trim().toUpperCase();
  if (CHART_SEGMENTS.has(raw)) return raw as DhanChartExchangeSegment;
  throw new DhanError(
    `Dhan chart exchangeSegment '${input || ""}' is not supported.`,
    400,
    "DHAN_INVALID_HISTORY_REQUEST",
    { field: "exchangeSegment", value: input, allowed: DHAN_CHART_EXCHANGE_SEGMENTS }
  );
}

function normalizeDhanChartInterval(input?: string): DhanChartInterval | undefined {
  if (input === undefined || input === null || input === "") return undefined;
  const raw = String(input).trim();
  if (CHART_INTERVALS.has(raw)) return raw as DhanChartInterval;
  throw new DhanError(
    `Dhan chart interval '${input}' is not supported.`,
    400,
    "DHAN_INVALID_HISTORY_REQUEST",
    { field: "interval", value: input, allowed: DHAN_CHART_INTERVALS }
  );
}

function assertRequiredString(field: "securityId" | "fromDate" | "toDate", value: string | undefined): string {
  const normalized = String(value ?? "").trim();
  if (normalized) return normalized;
  throw new DhanError(
    `Dhan chart request is missing '${field}'.`,
    400,
    "DHAN_INVALID_HISTORY_REQUEST",
    { field }
  );
}

export function normalizeDhanChartRequest(input: DhanChartRequestInput): NormalizedDhanChartRequest {
  const normalized: NormalizedDhanChartRequest = {
    securityId: assertRequiredString("securityId", input.securityId),
    exchangeSegment: normalizeDhanChartSegment(input.exchangeSegment),
    instrument: normalizeDhanChartInstrument(input.instrument, input.exchangeSegment),
    interval: normalizeDhanChartInterval(input.interval),
    fromDate: assertRequiredString("fromDate", input.fromDate),
    toDate: assertRequiredString("toDate", input.toDate),
    expiryCode: input.expiryCode ?? 0,
    oi: input.oi ?? false
  };

  if (!Number.isInteger(normalized.expiryCode) || normalized.expiryCode < 0) {
    throw new DhanError(
      "Dhan chart expiryCode must be a non-negative integer.",
      400,
      "DHAN_INVALID_HISTORY_REQUEST",
      { field: "expiryCode", value: input.expiryCode }
    );
  }

  return normalized;
}

export function isDhanChartCompatibleInstrument(input?: string): boolean {
  try {
    normalizeDhanChartInstrument(input);
    return true;
  } catch {
    return false;
  }
}

export type DhanDisplaySegment = "EQ" | "FNO" | "INDEX" | "COMM" | "CURRENCY";

export function toDhanDisplaySegment(exchangeSegment: string, instrument?: string): DhanDisplaySegment {
  const segment = exchangeSegment.trim().toUpperCase();
  const inst = (instrument || "").trim().toUpperCase();
  if (segment === "IDX_I" || inst === "INDEX" || inst === "IDX") return "INDEX";
  if (segment === "MCX_COMM") return "COMM";
  if (segment.endsWith("_CURRENCY")) return "CURRENCY";
  if (segment.endsWith("_FNO") || inst.startsWith("FUT") || inst.startsWith("OPT")) return "FNO";
  return "EQ";
}
