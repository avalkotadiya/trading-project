import Link from "next/link";
import { APP_NAME } from "@/lib/constants";

export function SiteFooter() {
  return (
    <footer className="relative border-t border-white/10 py-10">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-glow/50 to-transparent" />
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 text-sm text-slate-500 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
        <p>{APP_NAME}. Live provider-backed market data.</p>
        <div className="flex gap-4">
          <Link href="/dashboard" className="transition hover:text-cyan-soft">
            Dashboard
          </Link>
          <Link href="/scanner-pro" className="transition hover:text-cyan-soft">
            Scanner
          </Link>
          <Link href="/billing" className="transition hover:text-cyan-soft">
            Billing
          </Link>
        </div>
      </div>
    </footer>
  );
}
