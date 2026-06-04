"use client";

import { LiveTicker } from "@/components/dashboard/live-ticker";
import { MarketDataBoard } from "@/components/dashboard/market-data-board";
import { RecentAlerts } from "@/components/dashboard/recent-alerts";
import { WatchlistPanel } from "@/components/dashboard/watchlist-panel";
import { WalletCard } from "@/components/dashboard/wallet-card";
import { AiTradingBot } from "@/components/dashboard/ai-trading-bot";
import { DASHBOARD_SYMBOLS } from "@/lib/constants";
import type { MarketTick } from "@/types/market";
import type { AlertSummary, WatchlistSummary } from "@/types/platform";
import type { SubscriptionState } from "@/types/subscription";

type DashboardClientProps = {
  watchlists: WatchlistSummary[];
  alerts: AlertSummary[];
  billingOverview: {
    currentSubscription: SubscriptionState;
  };
  market: {
    ticks: MarketTick[];
    providerHealth: {
      status: string;
      message?: string;
    }
  };
  token: string;
};

export function DashboardClient({
  watchlists,
  alerts,
  billingOverview,
  market,
  token
}: DashboardClientProps) {
  // Cards used to be gated by useDashboardSettings (localStorage flags), but
  // no UI ever exposed a toggle for those flags. The hook only persisted
  // values from a removed older version, which meant a stale localStorage
  // entry could silently hide the bot. Render unconditionally now.
  return (
    <div className="space-y-5 pb-20">
      <LiveTicker initialTicks={market.ticks} token={token} />

      <MarketDataBoard
        initialTicks={market.ticks}
        token={token}
        providerStatus={market.providerHealth.status}
        providerMessage={market.providerHealth.message}
        fallbackSymbols={DASHBOARD_SYMBOLS}
      />

      {/* AI Bot occupies the full dashboard row — the Edge list, KPI strip,
          progress bar and tabs all benefit from horizontal breathing room. */}
      <AiTradingBot />

      {/* Companion cards collapse to a single column on mobile, 2 cols on
          tablet, and 3 cols on wide desktops so they line up under the bot
          rather than squeezing into a narrow sidebar. */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <WalletCard />
        <WatchlistPanel
          initialWatchlists={watchlists}
          currentSubscription={billingOverview.currentSubscription}
          initialTicks={market.ticks}
          token={token}
        />
        <RecentAlerts alerts={alerts} token={token} />
      </div>
    </div>
  );
}
