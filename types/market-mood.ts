export type MarketMoodLabel = "PANIC" | "FEAR" | "CAUTION" | "NEUTRAL" | "OPTIMISM" | "GREED" | "EUPHORIA";

export type MarketMoodDriver = {
  label: string;
  value: string;
  tone: "positive" | "negative" | "neutral";
};

export type MarketMoodInsight = {
  asset: string;
  score: number;
  gauge: number;
  label: MarketMoodLabel;
  summary: string;
  drivers: MarketMoodDriver[];
  sampleSize: number;
  updatedAt: string;
  source: "live" | "polling" | "snapshot" | "unavailable";
};
