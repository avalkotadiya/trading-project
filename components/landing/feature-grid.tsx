import { BellRing, CandlestickChart, LineChart, LockKeyhole, Radar, WalletCards } from "lucide-react";

const features = [
  {
    title: "Live Market Dashboard",
    description: "Overview cards, watchlists, live tick simulation, and TradingView widgets in one focused desk.",
    icon: LineChart
  },
  {
    title: "Stock Scanner",
    description: "Volume spike detection, momentum ranking, and bullish or bearish setup classification.",
    icon: Radar
  },
  {
    title: "Options Analytics",
    description: "PCR, open interest concentration, max pain context, and option-chain visualization.",
    icon: CandlestickChart
  },
  {
    title: "Trading Alerts",
    description: "Price, volume, and momentum alert APIs ready for real notification channels.",
    icon: BellRing
  },
  {
    title: "Secure SaaS Auth",
    description: "Clerk-powered signup, login, logout, and protected route middleware with local demo fallback.",
    icon: LockKeyhole
  },
  {
    title: "Subscription Ready",
    description: "Free and Pro plans with Razorpay checkout placeholders and scalable billing models.",
    icon: WalletCards
  }
];

export function FeatureGrid() {
  return (
    <section id="features" className="border-t border-white/10 py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-soft">Platform</p>
          <h2 className="mt-3 text-3xl font-semibold text-white sm:text-4xl">Built for fast trading decisions</h2>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon;

            return (
              <article key={feature.title} className="glass-panel depth-card rounded-lg p-5">
                <span className="flex h-11 w-11 items-center justify-center rounded-md bg-cyan-glow/[0.12] text-cyan-soft">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="mt-5 text-lg font-semibold text-white">{feature.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-400">{feature.description}</p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
