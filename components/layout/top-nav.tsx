"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Command, Search, Sparkles } from "lucide-react";
import { HeaderAuthActions, UserMenu } from "@/components/auth/auth-actions";
import { ThemeToggle } from "@/components/layout/theme-toggle";

type TopNavProps = {
  clerkEnabled: boolean;
  dashboard?: boolean;
};

export function TopNav({ clerkEnabled, dashboard = false }: TopNavProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      router.push("/scanner-pro");
      return;
    }

    router.push(`/scanner-pro?query=${encodeURIComponent(trimmedQuery)}`);
  }

  if (!dashboard) {
    return (
      <header className="fixed left-0 right-0 top-0 z-40 border-b border-white/10 bg-[#030711]/[0.7] shadow-[0_14px_60px_rgba(0,0,0,0.22)] backdrop-blur-2xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-soft transition hover:text-white">
            Sahara
          </Link>
          <HeaderAuthActions clerkEnabled={clerkEnabled} />
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-[#030711]/[0.72] shadow-[0_14px_60px_rgba(0,0,0,0.2)] backdrop-blur-2xl">
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-cyan-glow/40 to-transparent" />
      <div className="flex h-16 items-center justify-between gap-4 px-4 md:px-8">
        <Link href="/dashboard" className="shrink-0 text-sm font-semibold uppercase tracking-[0.16em] text-cyan-soft md:hidden">
          Sahara
        </Link>
        <form
          className="hidden min-w-0 flex-1 items-center gap-3 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition focus-within:border-cyan-glow/40 focus-within:bg-white/[0.08] md:flex"
          onSubmit={handleSearch}
        >
          <Search className="h-4 w-4 text-slate-500" />
          <input
            aria-label="Search symbols"
            maxLength={80}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search NIFTY, RELIANCE, option chains..."
            value={query}
            className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
          />
          <span className="hidden items-center gap-1 rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-slate-500 lg:inline-flex">
            <Command className="h-3 w-3" />
            K
          </span>
        </form>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 rounded-full border border-cyan-glow/20 bg-cyan-glow/10 px-3 py-1.5 text-xs font-medium text-cyan-soft shadow-[0_0_28px_rgba(56,232,255,0.08)] sm:flex">
            <Sparkles className="h-3.5 w-3.5" />
            AI Signal Lab
          </div>
          <ThemeToggle />
          <UserMenu clerkEnabled={clerkEnabled} />
        </div>
      </div>
    </header>
  );
}
