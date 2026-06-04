"use client";

import { useState } from "react";
import { CreditCard } from "lucide-react";
import { PricingCard } from "@/components/billing/pricing-card";
import { Badge } from "@/components/ui/badge";
import type { SubscriptionPlan, SubscriptionState } from "@/types/subscription";
import { formatRelativeTime } from "@/utils/format";

type BillingWorkspaceProps = {
  plans: SubscriptionPlan[];
  initialSubscription: SubscriptionState;
};

export function BillingWorkspace({ plans, initialSubscription }: BillingWorkspaceProps) {
  const [currentSubscription, setCurrentSubscription] = useState(initialSubscription);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-white/10 bg-white/[0.05] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-white">Current subscription</p>
            <p className="mt-2 text-2xl font-semibold text-white">
              {currentSubscription.planName ?? "No active plan"}
            </p>
            <p className="mt-1 text-sm text-slate-400">
              {currentSubscription.isAdminGrant
                ? currentSubscription.adminGrantRole === "OWNER"
                  ? "Full Pro access granted by owner role — every feature unlocked, no billing required."
                  : "Pro features granted by admin role — no billing required."
                : currentSubscription.currentPeriodEnd
                  ? `Renews ${formatRelativeTime(currentSubscription.currentPeriodEnd)}`
                  : "Free access is active until you upgrade."}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {currentSubscription.isAdminGrant && (
              <Badge tone={currentSubscription.adminGrantRole === "OWNER" ? "amber" : "cyan"}>
                {currentSubscription.adminGrantRole === "OWNER" ? "Owner" : "Admin"}
              </Badge>
            )}
            <Badge tone={currentSubscription.planKey === "pro" ? "cyan" : "green"}>
              {currentSubscription.status?.toLowerCase() ?? "inactive"}
            </Badge>
            <span className="flex h-12 w-12 items-center justify-center rounded-md bg-cyan-glow/10 text-cyan-soft">
              <CreditCard className="h-5 w-5" />
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {plans.map((plan) => (
          <PricingCard
            key={plan.key}
            plan={plan}
            currentSubscription={currentSubscription}
            onSubscriptionChange={setCurrentSubscription}
          />
        ))}
      </div>
    </div>
  );
}
