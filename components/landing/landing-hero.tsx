import Link from "next/link";
import { ArrowRight, ShieldCheck, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { MarketPulsePreview } from "@/components/landing/market-pulse-preview";

export function LandingHero() {
  return (
    <section className="relative min-h-[92vh] overflow-hidden pt-24">
      <div className="absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-cyan-glow/[0.1] to-transparent" />
      <div className="relative mx-auto grid max-w-7xl gap-8 px-4 pb-12 sm:px-6 lg:px-8">
        <div className="max-w-4xl pt-10">
          <Badge tone="cyan" className="gap-2 shadow-[0_0_36px_rgba(59,130,246,0.12)]">
            <Zap className="h-3.5 w-3.5" />
            AI-powered Indian market intelligence
          </Badge>
          <h1 className="cinematic-title mt-6 max-w-4xl text-4xl font-semibold tracking-normal sm:text-5xl lg:text-7xl">
            Sahara Trade Intelligence
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
            A modern trading desk for scanners, options analytics, live market widgets, alerts, and subscription-ready SaaS workflows.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/dashboard"
              className="kinetic-sheen inline-flex h-12 items-center justify-center gap-2 rounded-md bg-cyan-glow px-5 text-sm font-semibold text-white shadow-[0_18px_46px_rgba(59,130,246,0.24)] transition hover:-translate-y-0.5 hover:bg-cyan-soft"
            >
              Launch demo
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="#pricing"
              className="holo-edge inline-flex h-12 items-center justify-center gap-2 rounded-md border border-white/10 bg-white/[0.08] px-5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-white/[0.12]"
            >
              View pricing
            </Link>
          </div>
          <div className="mt-8 flex flex-wrap gap-4 text-sm text-slate-400">
            <span className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-trade-green" />
              Clerk-ready auth
            </span>
            <span className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-trade-green" />
              Prisma PostgreSQL schema
            </span>
            <span className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-trade-green" />
              Vercel-ready routes
            </span>
          </div>
        </div>

        <div className="relative [perspective:1200px]">
          <div className="animate-[floatPanel_7s_ease-in-out_infinite] [transform:rotateX(4deg)_rotateY(-5deg)]">
            <MarketPulsePreview />
          </div>
        </div>
      </div>
    </section>
  );
}
