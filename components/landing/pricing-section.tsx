import Link from "next/link";
import { Check } from "lucide-react";
import { SUBSCRIPTION_PLANS } from "@/lib/constants";
import { formatCurrency } from "@/utils/format";
import { cn } from "@/utils/cn";

export function PricingSection() {
  return (
    <section id="pricing" className="border-t border-white/10 py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-soft">Pricing</p>
          <h2 className="mt-3 text-3xl font-semibold text-white sm:text-4xl">Start free, upgrade when signals matter</h2>
        </div>
        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          {SUBSCRIPTION_PLANS.map((plan) => (
            <article
              key={plan.key}
              className={cn(
                "depth-card rounded-lg border p-6",
                plan.highlighted
                  ? "glass-panel border-cyan-glow/40 bg-cyan-glow/10 shadow-glow"
                  : "glass-panel border-white/10 bg-white/[0.05]"
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-semibold text-white">{plan.name}</h3>
                  <p className="mt-2 max-w-md text-sm leading-6 text-slate-400">{plan.description}</p>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-semibold text-white">{formatCurrency(plan.priceInr)}</p>
                  <p className="text-sm text-slate-400">per {plan.interval}</p>
                </div>
              </div>
              <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm text-slate-300">
                    <Check className="h-4 w-4 text-trade-green" />
                    {feature}
                  </li>
                ))}
              </ul>
              <Link
                href={plan.key === "free" ? "/dashboard" : "/billing"}
                className={cn(
                  "mt-6 inline-flex h-11 items-center justify-center rounded-md px-4 text-sm font-semibold transition hover:-translate-y-0.5",
                  plan.highlighted
                    ? "kinetic-sheen bg-cyan-glow text-slate-950 shadow-[0_18px_46px_rgba(56,232,255,0.2)] hover:bg-cyan-soft"
                    : "holo-edge border border-white/10 bg-white/[0.08] text-white hover:bg-white/[0.12]"
                )}
              >
                {plan.key === "free" ? "Use Free" : "Upgrade to Pro"}
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
