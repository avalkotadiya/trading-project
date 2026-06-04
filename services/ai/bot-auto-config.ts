/**
 * Bot auto-config — turns "user equity + total wallet cap" into a fully
 * configured bot. Replaces per-user knobs (min edge %, min score, Kelly cap,
 * risk %, max positions, daily loss) with sensible auto-tuned defaults.
 *
 * The user sets only ONE ₹ knob: `maxDeployedCapital` — the ceiling on total
 * exposure across all open bot positions. Per-trade size is derived from the
 * cap and the slot count (`equity ÷ maxOpenPositions`).
 *
 * Why these specific numbers:
 *  - Min edge 0.05% — looser than the historical 0.35% so paper-mode demos
 *    actually fire trades on average days. Backtest math is preserved; the
 *    composite score does the real quality filtering.
 *  - Min composite 35 — let the indicator stack admit reasonable setups
 *    even when one factor (low RVOL on an index day) drags the blend down.
 *  - Kelly cap 0.5 — half-Kelly, the literature's drawdown sweet spot.
 *  - Risk 1.0%/trade — equity at risk per ATR stop.
 *  - Max positions = clamp(5, floor(cap / minTicket), 15). Cheap symbols
 *    let the bot diversify; expensive ones force concentration.
 *  - Daily loss = 5% of equity (min ₹500). Standard professional risk cap.
 */

const MIN_TICKET_RUPEES = 500;

export type UserSizingInput = {
  equity: number;
  maxDeployedCapital: number;
};

export type AutoTunedGates = {
  botMinEdgePct: number;
  botMinCompositeScore: number;
  botKellyCap: number;
  botRiskPctPerTrade: number;
  botMaxOpenPositions: number;
  botMaxDailyLoss: number;
};

export type EffectiveBotConfig = AutoTunedGates & {
  autoTradeEnabled: boolean;
  botTradeMode: "PAPER" | "LIVE";
  maxDeployedCapital: number;
};

export function computeAutoTunedGates(input: UserSizingInput): AutoTunedGates {
  const { equity, maxDeployedCapital } = input;

  // Slot count driven by the wallet cap: a ₹50K cap with a ₹500 minimum
  // ticket = up to 100 micro-positions, clamped to 15 to avoid lot-fragment
  // chaos. A ₹100K cap with the same minimum behaves identically — the
  // bot only opens what the candidate score warrants.
  const slotsByCap = Math.floor(Math.max(1, maxDeployedCapital) / MIN_TICKET_RUPEES);
  const botMaxOpenPositions = Math.max(2, Math.min(15, slotsByCap || 2));

  // 5% of equity per day is the standard professional drawdown ceiling.
  const botMaxDailyLoss = Math.max(500, Math.round(equity * 0.05));

  return {
    botMinEdgePct: 0.05,
    botMinCompositeScore: 35,
    botKellyCap: 0.5,
    botRiskPctPerTrade: 1.0,
    botMaxOpenPositions,
    botMaxDailyLoss
  };
}

/**
 * Convenience wrapper: takes a User row + auto-tunes the gates. The returned
 * shape is what BOTH the cycle loop and the UI see — single source of truth.
 */
export function computeEffectiveConfig(args: {
  autoTradeEnabled: boolean;
  botTradeMode: "PAPER" | "LIVE";
  equity: number;
  maxDeployedCapital: number;
}): EffectiveBotConfig {
  const gates = computeAutoTunedGates(args);
  return {
    autoTradeEnabled: args.autoTradeEnabled,
    botTradeMode: args.botTradeMode,
    maxDeployedCapital: args.maxDeployedCapital,
    ...gates
  };
}
