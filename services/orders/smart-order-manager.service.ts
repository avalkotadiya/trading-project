import { randomUUID } from "node:crypto";
import type { AiDirection, PortfolioRiskInsight, SmartOrderPreview } from "@/types/ai-trading";

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

export function buildSmartOrderPreview(params: {
  symbol: string;
  direction: AiDirection;
  entry: number;
  stopLoss: number | null;
  targets: number[];
  quantity: number;
  accountRiskPercent: number;
  portfolioRisk: PortfolioRiskInsight;
  securityId?: string;
  exchangeSegment?: string;
}): SmartOrderPreview {
  const tradeDirection = params.direction === "BEARISH" ? "SELL" : "BUY";
  const firstTarget = params.targets[0] ?? params.entry;
  const stopDistance = params.stopLoss ? Math.abs(params.entry - params.stopLoss) : params.entry * 0.015;
  const rewardDistance = Math.abs(firstTarget - params.entry);
  const riskRewardRatio = rewardDistance / Math.max(0.01, stopDistance);
  const guardrails = [
    "Manual confirmation required before live order placement.",
    "Validate Dhan margin response immediately before execution.",
    "Reject order when live price deviates beyond configured slippage."
  ];

  if (params.direction === "NEUTRAL") {
    guardrails.unshift("Signal is neutral; live order should stay disabled.");
  }
  if (params.portfolioRisk.riskPosture === "defensive") {
    guardrails.push("Portfolio risk posture is defensive; suggested quantity was reduced.");
  }

  return {
    transactionType: tradeDirection,
    orderType: "LIMIT",
    quantity: Math.max(1, params.quantity),
    entry: round(params.entry),
    stopLoss: params.stopLoss === null ? null : round(params.stopLoss),
    targets: params.targets.map((target) => round(target)),
    riskRewardRatio: round(riskRewardRatio, 2),
    estimatedMaxLoss: round(stopDistance * Math.max(1, params.quantity)),
    accountRiskPercent: params.accountRiskPercent,
    requiresConfirmation: true,
    guardrails,
    dhan: {
      exchangeSegment: params.exchangeSegment || "NSE_EQ",
      securityId: params.securityId || null,
      correlationId: `ai-${randomUUID()}`,
      marginCheck: process.env.DHAN_ACCESS_TOKEN ? "configured" : "unavailable",
      staticIpReminder: true
    }
  };
}
