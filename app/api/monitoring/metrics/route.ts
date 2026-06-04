import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api-response";
import { getRuntimeMetrics } from "@/lib/monitoring";

export async function GET(request: NextRequest) {
  const token = process.env.MONITORING_TOKEN;

  // Deny by default: if MONITORING_TOKEN is not configured the endpoint is
  // closed. An empty/absent env var must not grant open access.
  if (!token || request.headers.get("x-monitoring-token") !== token) {
    return fail("FORBIDDEN", "Monitoring access requires a valid token.", 403);
  }

  return ok(getRuntimeMetrics());
}
