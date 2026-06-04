"use client";

import Link from "next/link";
import { useState } from "react";
import { SignInButton, SignOutButton, SignUpButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { Loader2, LogOut, UserRound } from "lucide-react";

type AuthActionsProps = {
  clerkEnabled: boolean;
};

export function HeaderAuthActions({ clerkEnabled }: AuthActionsProps) {
  if (!clerkEnabled) {
    return (
      <div className="flex items-center gap-2">
        <Link
          href="/sign-in"
          className="inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium text-slate-300 transition hover:bg-white/[0.08] hover:text-white"
        >
          Login
        </Link>
        <Link
          href="/sign-up"
          className="inline-flex h-10 items-center justify-center rounded-md bg-cyan-glow px-4 text-sm font-medium text-white shadow-glow transition hover:bg-cyan-soft"
        >
          Sign up
        </Link>
      </div>
    );
  }

  return (
    <>
      <SignedOut>
        <div className="flex items-center gap-2">
          <SignInButton mode="modal">
            <button
              className="inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium text-slate-300 transition hover:bg-white/[0.08] hover:text-white"
              type="button"
            >
              Login
            </button>
          </SignInButton>
          <SignUpButton mode="modal">
            <button
              className="inline-flex h-10 items-center justify-center rounded-md bg-cyan-glow px-4 text-sm font-medium text-white shadow-glow transition hover:bg-cyan-soft"
              type="button"
            >
              Sign up
            </button>
          </SignUpButton>
        </div>
      </SignedOut>
      <SignedIn>
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="hidden h-10 items-center justify-center rounded-md border border-white/10 bg-white/[0.08] px-4 text-sm font-medium text-white transition hover:bg-white/[0.12] sm:inline-flex"
          >
            Dashboard
          </Link>
          <UserButton afterSignOutUrl="/" />
        </div>
      </SignedIn>
    </>
  );
}

export function UserMenu({ clerkEnabled }: AuthActionsProps) {
  const [signingOut, setSigningOut] = useState(false);

  async function handleDatabaseSignOut() {
    setSigningOut(true);

    await fetch("/api/auth/sign-out", {
      method: "POST"
    }).catch(() => null);

    window.location.href = "/sign-in";
  }

  if (!clerkEnabled) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-cyan-glow/[0.15] text-cyan-soft">
          <UserRound className="h-4 w-4" />
        </span>
        <div className="hidden min-w-0 sm:block">
          <p className="truncate text-sm font-medium text-white">Sahara Account</p>
          <p className="truncate text-xs text-slate-400">Database auth</p>
        </div>
        <button
          aria-label="Sign out"
          className="flex h-9 w-9 items-center justify-center rounded-md text-slate-300 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
          disabled={signingOut}
          onClick={handleDatabaseSignOut}
          type="button"
        >
          {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <UserButton afterSignOutUrl="/" />
      <SignOutButton>
        <button
          aria-label="Sign out"
          className="flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white"
          type="button"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </SignOutButton>
    </div>
  );
}
