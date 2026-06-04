"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, LockKeyhole, Mail, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { sanitizeAuthSearchParams, sanitizeRedirectPath, shouldStripAuthSearchParam } from "@/lib/auth-url";

type AuthFormProps = {
  mode: "sign-in" | "sign-up";
  redirectUrl?: string;
};

type AuthResponse = {
  ok: boolean;
  data?: {
    user: {
      id: string;
      email: string;
      name: string | null;
    };
  };
  error?: {
    message: string;
  };
};

function buildAuthSwitchHref(path: "/sign-in" | "/sign-up", redirectUrl?: string) {
  const safeRedirect = sanitizeRedirectPath(redirectUrl);
  if (safeRedirect === "/dashboard") {
    return path;
  }

  return `${path}?redirect_url=${encodeURIComponent(safeRedirect)}`;
}

export function AuthForm({ mode, redirectUrl }: AuthFormProps) {
  const router = useRouter();
  const isSignUp = mode === "sign-up";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const safeRedirectUrl = sanitizeRedirectPath(redirectUrl);

  useEffect(() => {
    const currentUrl = new URL(window.location.href);
    const hasUnsafeParams = Array.from(currentUrl.searchParams.keys()).some((key) => shouldStripAuthSearchParam(key));
    const cleanParams = sanitizeAuthSearchParams(currentUrl.searchParams);
    const cleanSearch = cleanParams.toString();

    if (hasUnsafeParams || currentUrl.searchParams.toString() !== cleanSearch) {
      const cleanUrl = `${currentUrl.pathname}${cleanSearch ? `?${cleanSearch}` : ""}${currentUrl.hash}`;
      window.history.replaceState(null, "", cleanUrl);
    }
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");
    setMessage("");

    const formData = new FormData(event.currentTarget);
    const submittedName = String(formData.get("name") ?? "");
    const submittedEmail = String(formData.get("email") ?? "");
    const submittedPassword = String(formData.get("password") ?? "");
    const endpoint = isSignUp ? "/api/auth/sign-up" : "/api/auth/sign-in";
    const payload = isSignUp
      ? { name: submittedName, email: submittedEmail, password: submittedPassword }
      : { email: submittedEmail, password: submittedPassword };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      const result = (await response.json()) as AuthResponse;

      if (!response.ok || !result.ok) {
        throw new Error(result.error?.message || "Authentication failed.");
      }

      setPassword("");

      startTransition(() => {
        router.push(safeRedirectUrl);
        router.refresh();
      });
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Unable to authenticate right now.");
    }
  }

  return (
    <Card className="w-full max-w-md overflow-hidden rounded-lg">
      <CardHeader className="border-b border-white/10">
        <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-md border border-cyan-glow/20 bg-cyan-glow/10 text-cyan-soft">
          <LockKeyhole className="h-5 w-5" />
        </div>
        <CardTitle className="text-2xl">{isSignUp ? "Create your account" : "Welcome back"}</CardTitle>
        <CardDescription>
          {isSignUp
            ? "Start tracking scanners, alerts, watchlists, and options data."
            : "Sign in to open your Sahara trading workspace."}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-5">
        <form className="space-y-4" onSubmit={handleSubmit}>
          {isSignUp ? (
            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-300">Name</span>
              <div className="relative">
                <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <Input
                  autoComplete="name"
                  className="pl-10"
                  minLength={2}
                  maxLength={80}
                  name="name"
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Aarav Sharma"
                  required
                  value={name}
                />
              </div>
            </label>
          ) : null}

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-300">Email</span>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <Input
                autoComplete="email"
                className="pl-10"
                inputMode="email"
                maxLength={160}
                name="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
                type="email"
                value={email}
                onFocus={() => router.prefetch(safeRedirectUrl)}
              />
            </div>
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-300">Password</span>
            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <Input
                autoComplete={isSignUp ? "new-password" : "current-password"}
                className="pl-10"
                maxLength={128}
                minLength={8}
                name="password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Minimum 8 characters"
                required
                type="password"
                value={password}
              />
            </div>
          </label>

          {message ? (
            <div className="rounded-md border border-trade-red/25 bg-trade-red/10 px-3 py-2 text-sm text-red-200">
              {message}
            </div>
          ) : null}

          <Button className="w-full" disabled={status === "loading" || isPending} size="lg" type="submit">
            {status === "loading" || isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isSignUp ? "Create account" : "Sign in"}
            {status === "loading" || isPending ? null : <ArrowRight className="h-4 w-4" />}
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-slate-400">
          {isSignUp ? "Already have an account?" : "New to Sahara?"}{" "}
          <Link
            className="font-medium text-cyan-soft transition hover:text-cyan-glow"
            href={buildAuthSwitchHref(isSignUp ? "/sign-in" : "/sign-up", safeRedirectUrl)}
          >
            {isSignUp ? "Sign in" : "Create an account"}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
