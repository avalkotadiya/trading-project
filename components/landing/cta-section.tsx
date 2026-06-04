import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function CtaSection() {
  return (
    <section className="border-t border-white/10 py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="glass-panel depth-card relative rounded-lg border-cyan-glow/25 bg-cyan-glow/10 p-8 sm:p-10">
          <div className="absolute inset-0 bg-market-grid bg-[size:32px_32px] opacity-20" />
          <div className="relative max-w-2xl">
            <h2 className="text-3xl font-semibold text-white sm:text-4xl">Bring the trading desk online</h2>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              The MVP includes auth, dashboards, scanner APIs, options analytics, subscriptions, Prisma schema, and deployment notes.
            </p>
            <Link
              href="/dashboard"
              className="kinetic-sheen mt-6 inline-flex h-12 items-center justify-center gap-2 rounded-md bg-cyan-glow px-5 text-sm font-semibold text-slate-950 shadow-[0_18px_46px_rgba(56,232,255,0.22)] transition hover:-translate-y-0.5 hover:bg-cyan-soft"
            >
              Open dashboard
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
