import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth-config";
import { hasUnsafeQueryParams, isSensitiveQueryParam, sanitizeAuthSearchParams } from "@/lib/auth-url";
import { isClerkConfigured } from "@/lib/env";

const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/portfolio(.*)",
  "/scanner(.*)",
  "/options(.*)",
  "/alerts(.*)",
  "/analytics(.*)",
  "/billing(.*)",
  "/settings(.*)",
  "/admin(.*)"
]);

const clerkIsConfigured = isClerkConfigured();

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...Array.from(bytes)));
}

function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    // nonce replaces unsafe-inline; unsafe-eval kept for Clerk/TradingView internals
    `script-src 'self' 'nonce-${nonce}' 'unsafe-eval' https://s3.tradingview.com https://*.clerk.accounts.dev https://*.clerk.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' ws://localhost:3001 wss://localhost:3001 https://api.telegram.org https://graph.facebook.com https://*.clerk.accounts.dev https://*.clerk.com",
    "frame-src https://s.tradingview.com https://www.tradingview.com https://*.clerk.accounts.dev https://*.clerk.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join("; ");
}

function applyNonceHeaders(request: NextRequest): { requestHeaders: Headers; nonce: string } {
  const nonce = generateNonce();
  const requestHeaders = new Headers(request.headers);
  // x-nonce is read by the root layout Server Component
  requestHeaders.set("x-nonce", nonce);
  return { requestHeaders, nonce };
}

function scrubUnsafeAuthUrl(request: NextRequest) {
  const isAuthPage = request.nextUrl.pathname === "/sign-in" || request.nextUrl.pathname === "/sign-up";
  const hasUnsafeParams = hasUnsafeQueryParams(request.nextUrl.searchParams, isAuthPage);

  if (!hasUnsafeParams) {
    return null;
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { ok: false, error: { code: "UNSAFE_QUERY_PARAMS", message: "Do not send credentials or secrets in the URL." } },
      { status: 400 }
    );
  }

  const cleanUrl = request.nextUrl.clone();

  if (isAuthPage) {
    const cleanParams = sanitizeAuthSearchParams(request.nextUrl.searchParams);
    cleanUrl.search = cleanParams.toString();
  } else {
    for (const key of Array.from(cleanUrl.searchParams.keys())) {
      if (isSensitiveQueryParam(key)) {
        cleanUrl.searchParams.delete(key);
      }
    }
  }

  const response = NextResponse.redirect(cleanUrl, { status: 303 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function databaseAuthMiddleware(request: NextRequest) {
  const scrubbedResponse = scrubUnsafeAuthUrl(request);
  if (scrubbedResponse) return scrubbedResponse;

  if (isProtectedRoute(request) && !request.cookies.get(SESSION_COOKIE_NAME)?.value) {
    const signInUrl = new URL("/sign-in", request.nextUrl);
    signInUrl.searchParams.set("redirect_url", request.nextUrl.pathname);
    return NextResponse.redirect(signInUrl);
  }

  const { requestHeaders, nonce } = applyNonceHeaders(request);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", buildCsp(nonce));
  return response;
}

export default clerkIsConfigured
  ? clerkMiddleware(async (auth, request) => {
      const scrubbedResponse = scrubUnsafeAuthUrl(request);
      if (scrubbedResponse) return scrubbedResponse;

      if (isProtectedRoute(request)) {
        await auth.protect();
      }

      const { requestHeaders, nonce } = applyNonceHeaders(request);
      const response = NextResponse.next({ request: { headers: requestHeaders } });
      response.headers.set("Content-Security-Policy", buildCsp(nonce));
      return response;
    })
  : databaseAuthMiddleware;

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ico|ttf|woff2?|map)).*)", "/api/(.*)"]
};
