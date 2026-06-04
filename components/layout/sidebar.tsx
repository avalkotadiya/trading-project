"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  Bell,
  CandlestickChart,
  CreditCard,
  Gauge,
  LineChart,
  PieChart,
  Shield,
  Settings,
  WalletCards,
  SlidersHorizontal,
  Crosshair
} from "lucide-react";
import { APP_NAME, NAV_ITEMS } from "@/lib/constants";
import { cn } from "@/utils/cn";

const icons = {
  Dashboard: Gauge,
  Charts: LineChart,
  Portfolio: WalletCards,
  Scanner: SlidersHorizontal,
  Insider: Crosshair,
  Options: CandlestickChart,
  Alerts: Bell,
  Analytics: PieChart,
  Billing: CreditCard,
  Settings,
  Admin: Shield
};

type SidebarProps = {
  isAdmin?: boolean;
};

export function Sidebar({ isAdmin = false }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-30 hidden h-screen w-60 overflow-hidden border-r border-white/10 bg-[#030711]/[0.8] p-4 shadow-[22px_0_80px_rgba(0,0,0,0.28)] backdrop-blur-2xl md:flex md:flex-col">
      <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-cyan-glow/40 to-transparent" />
      <Link href="/" className="relative flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.045] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
        <Image src="/sahara-mark.svg" alt="" width={34} height={34} className="shrink-0 rounded-md" priority />
        <div className="leading-tight">
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-soft">Sahara</div>
          <div className="text-[11px] text-slate-400">Trade Intelligence</div>
        </div>
      </Link>

      <div className="mt-5 grid grid-cols-3 gap-1 rounded-lg border border-white/10 bg-black/20 p-1">
        {["NSE", "AI", "RISK"].map((item) => (
          <div key={item} className="rounded-md bg-white/[0.045] px-1.5 py-1 text-center text-[10px] font-semibold tracking-wide text-slate-400">
            {item}
          </div>
        ))}
      </div>

      <nav className="mt-5 -mx-1 space-y-0.5">
        {NAV_ITEMS.filter((item) => !("adminOnly" in item) || !item.adminOnly || isAdmin).map((item) => {
          const Icon = icons[item.label] ?? LineChart;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition duration-200",
                active
                  ? "bg-cyan-glow/[0.14] text-cyan-soft shadow-[inset_0_0_0_1px_rgba(56,232,255,0.22),0_12px_30px_rgba(56,232,255,0.08)]"
                  : "text-slate-400 hover:-translate-y-0.5 hover:bg-white/[0.06] hover:text-white"
              )}
            >
              {active && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-cyan-glow shadow-[0_0_12px_rgba(56,232,255,0.9)]" />}
              <Icon className={cn("h-4 w-4 shrink-0", active ? "text-cyan-soft" : "text-slate-500 group-hover:text-slate-300")} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="glass-panel depth-card mt-auto rounded-lg px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-white">
          <span className="h-1.5 w-1.5 rounded-full bg-trade-green shadow-[0_0_10px_rgba(43,240,160,0.8)]" />
          Live engine
        </div>
        <div className="mt-3 grid grid-cols-12 items-end gap-0.5">
          {[34, 52, 44, 68, 58, 76, 62, 82, 70, 88, 74, 92].map((height, index) => (
            <span
              key={`${height}-${index}`}
              className="rounded-t-sm bg-cyan-glow/70"
              style={{ height: `${height / 4}px` }}
            />
          ))}
        </div>
        <p className="mt-1 text-[10px] leading-4 text-slate-500">
          Dhan WebSocket · 250 ms batched ticks
        </p>
      </div>

      <p className="mt-2 px-1 text-[10px] text-slate-600">{APP_NAME}</p>
    </aside>
  );
}
