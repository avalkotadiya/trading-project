"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CandlestickChart, CreditCard, Gauge, PieChart, Settings, Shield, SlidersHorizontal, WalletCards } from "lucide-react";
import { cn } from "@/utils/cn";

const mobileItems = [
  { label: "Home", href: "/dashboard", icon: Gauge },
  { label: "Charts", href: "/charts", icon: PieChart },
  { label: "Portfolio", href: "/portfolio", icon: WalletCards },
  { label: "Scan", href: "/scanner-pro", icon: SlidersHorizontal },
  { label: "Options", href: "/options", icon: CandlestickChart },
  { label: "Alerts", href: "/alerts", icon: Bell },
  { label: "Analytics", href: "/analytics", icon: PieChart },
  { label: "Billing", href: "/billing", icon: CreditCard },
  { label: "Settings", href: "/settings", icon: Settings },
  { label: "Admin", href: "/admin", icon: Shield, adminOnly: true }
];

type MobileNavProps = {
  isAdmin?: boolean;
};

export function MobileNav({ isAdmin = false }: MobileNavProps) {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-[#030711]/[0.82] px-2 py-2 shadow-[0_-18px_60px_rgba(0,0,0,0.28)] backdrop-blur-2xl md:hidden">
      <div className="no-scrollbar flex gap-1 overflow-x-auto">
        {mobileItems.filter((item) => !item.adminOnly || isAdmin).map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex h-14 min-w-[4.4rem] flex-col items-center justify-center gap-1 rounded-md px-1 text-[10px] transition min-[390px]:text-xs",
                active ? "bg-cyan-glow/[0.12] text-cyan-soft shadow-[inset_0_0_0_1px_rgba(59,130,246,0.2)]" : "text-slate-500 hover:bg-white/[0.06] hover:text-white"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
