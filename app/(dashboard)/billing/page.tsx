import { BillingWorkspace } from "@/components/billing/billing-workspace";
import { getBillingOverview } from "@/lib/platform-data";

export default async function BillingPage() {
  const billingOverview = await getBillingOverview();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-soft">Subscription</p>
        <h1 className="mt-2 text-3xl font-semibold text-white">Plans and billing</h1>
      </div>

      <BillingWorkspace
        plans={billingOverview.plans}
        initialSubscription={billingOverview.currentSubscription}
      />

      <div className="rounded-lg border border-white/10 bg-white/[0.05] p-5">
        <h2 className="text-lg font-semibold text-white">Payment setup</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
          Configure <span className="text-white font-medium">RAZORPAY_KEY_ID</span>,{" "}
          <span className="text-white font-medium">RAZORPAY_KEY_SECRET</span>, and{" "}
          <span className="text-white font-medium">RAZORPAY_WEBHOOK_SECRET</span> in your environment to activate live billing.
          Point your Razorpay webhook dashboard to{" "}
          <span className="text-cyan-soft font-mono text-xs">/api/billing/webhook</span> and select the{" "}
          <span className="text-white font-medium">payment.captured</span> and{" "}
          <span className="text-white font-medium">payment.failed</span> events.
        </p>
      </div>
    </div>
  );
}
