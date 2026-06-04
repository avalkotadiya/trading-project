import type { NextRequest } from "next/server";

export function getIpFromRequest(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";
}

export function isIpAllowed(ip: string, allowlistEnv?: string) {
  const allowlist = (allowlistEnv ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (allowlist.length === 0) return true;
  return allowlist.includes(ip);
}

