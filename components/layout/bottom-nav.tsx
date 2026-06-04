"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LineChart, WalletCards, MoreHorizontal, ScanSearch } from "lucide-react";
import { cn } from "@/utils/cn";

const NAV_ITEMS = [
  { label: "Home", href: "/dashboard", icon: Home },
  { label: "Charts", href: "/charts", icon: LineChart },
  { label: "Scanner", href: "/scanner-pro", icon: ScanSearch },
  { label: "Portfolio", href: "/portfolio", icon: WalletCards },
  { label: "More", href: "/settings", icon: MoreHorizontal },
];

export function BottomNavigation() {
  const pathname = usePathname();

  return (
    <div className="fixed bottom-0 left-0 z-50 w-full h-16 bg-[#030711]/90 backdrop-blur-lg border-t border-white/10 md:hidden">
      <div className="grid h-full max-w-lg grid-cols-5 mx-auto font-medium">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          
          return (
            <Link 
              key={item.href} 
              href={item.href}
              className="inline-flex flex-col items-center justify-center px-5 group"
            >
              <Icon className={cn(
                "w-5 h-5 mb-1 transition-colors",
                isActive ? "text-cyan-glow" : "text-slate-500 group-hover:text-slate-300"
              )} />
              <span className={cn(
                "text-[10px] transition-colors",
                isActive ? "text-cyan-glow" : "text-slate-500 group-hover:text-slate-300"
              )}>
                {item.label}
              </span>
              {isActive && (
                <div className="absolute top-0 h-0.5 w-8 bg-cyan-glow shadow-[0_0_8px_rgba(56,232,255,0.8)]" />
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
