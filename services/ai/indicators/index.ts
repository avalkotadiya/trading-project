/**
 * Indicator library for the AI Quant Bot.
 *
 * Each indicator is a pure function over OHLCV candles. They have no I/O,
 * no caching, and are safe to call from the auto-trader's hot loop. The
 * `composite` helper rolls everything into a single 0-100 score the sizer
 * uses to scale Half-Kelly.
 *
 * Why not a library like `technicalindicators`? Two reasons:
 *  1. We only need 5 indicators, not 80 — adding a dep is overkill.
 *  2. Bundling control: each function is < 60 LOC, easy to audit / tune.
 */

export { rsi, lastRsi } from "./rsi";
export { macd } from "./macd";
export type { MacdReadout } from "./macd";
export { adx } from "./adx";
export type { AdxReadout } from "./adx";
export { bollinger } from "./bollinger";
export type { BollingerReadout } from "./bollinger";
export { obv } from "./obv";
export type { ObvReadout } from "./obv";
export { composite } from "./composite";
export type { CompositeInputs, CompositeReadout } from "./composite";
