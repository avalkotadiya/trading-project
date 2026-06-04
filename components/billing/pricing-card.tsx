"use client";

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { SubscriptionPlan, SubscriptionState } from "@/types/subscription";
import { cn } from "@/utils/cn";
import { formatCurrency } from "@/utils/format";

type PricingCardProps = {
  plan: SubscriptionPlan;
  currentSubscription: SubscriptionState;
  onSubscriptionChange: (subscription: SubscriptionState) => void;
};

export function PricingCard({ plan, currentSubscription, onSubscriptionChange }: PricingCardProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const isCurrentPlan =
    currentSubscription.planKey === plan.key &&
    currentSubscription.status !== null &&
    currentSubscription.status !== "CANCELED";

  function startCheckout() {
    setMessage(null);

    startTransition(async () => {
      try {
        const response = await fetch("/api/billing/create-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planKey: plan.key, billingInterval: plan.interval })
        });
        const payload = await response.json();

        if (!response.ok || !payload.ok) {
          throw new Error(payload.error?.message ?? "Checkout failed.");
        }

        onSubscriptionChange(payload.data.subscription as SubscriptionState);
        setMessage(`${payload.data.message} Order: ${payload.data.orderId}`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Unable to start checkout.");
      }
    });
  }

  return (
    <article
      className={cn(
        "rounded-lg border p-6",
        plan.highlighted ? "border-cyan-glow/40 bg-cyan-glow/10 shadow-glow" : "border-white/10 bg-white/[0.05]"
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold text-white">{plan.name}</h2>
            {plan.highlighted ? <Badge tone="cyan">Popular</Badge> : null}
            {isCurrentPlan ? <Badge tone="green">{currentSubscription.status?.toLowerCase()}</Badge> : null}
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-400">{plan.description}</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-semibold text-white">{formatCurrency(plan.priceInr)}</p>
          <p className="text-sm text-slate-400">per {plan.interval}</p>
        </div>
      </div>

      <ul className="mt-6 space-y-3">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-center gap-2 text-sm text-slate-300">
            <Check className="h-4 w-4 text-trade-green" />
            {feature}
          </li>
        ))}
      </ul>

      <Button
        className="mt-6 w-full"
        variant={plan.highlighted ? "primary" : "secondary"}
        disabled={isPending || (isCurrentPlan && currentSubscription.status === "ACTIVE")}
        onClick={startCheckout}
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {isCurrentPlan && currentSubscription.status === "ACTIVE"
          ? "Current plan"
          : plan.key === "free"
            ? "Activate Free"
            : "Start Pro"}
      </Button>

      {message ? <p className="mt-4 rounded-md border border-white/10 bg-black/20 p-3 text-xs leading-5 text-slate-300">{message}</p> : null}
    </article>
  );
}
