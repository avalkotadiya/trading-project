import { ok } from "@/lib/api-response";
import { getSystemHealth } from "@/lib/monitoring";

export async function GET() {
  const health = await getSystemHealth();
  return ok(health, { status: health.status === "ok" ? 200 : 503 });
}
