import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { webhookSchema } from "@/services/dhan/dhanSchemas";

function getRequestIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";
}

function isAllowedIp(ip: string) {
  const allowlist = (process.env.DHAN_WEBHOOK_IP_ALLOWLIST ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (allowlist.length === 0) return true;
  return allowlist.includes(ip);
}

function isWebhookSecretValid(request: NextRequest): boolean {
  const configuredSecret = process.env.DHAN_WEBHOOK_SECRET?.trim();
  if (!configuredSecret) return true;
  const incomingSecret = request.headers.get("x-dhan-webhook-secret")?.trim() ?? "";
  if (!incomingSecret) return false;
  // Use timingSafeEqual to prevent timing oracle attacks
  try {
    const a = Buffer.from(configuredSecret, "utf8");
    const b = Buffer.from(incomingSecret, "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function isWebhookConfigured(): boolean {
  const hasIpAllowlist = (process.env.DHAN_WEBHOOK_IP_ALLOWLIST ?? "").trim().length > 0;
  const hasSecret = (process.env.DHAN_WEBHOOK_SECRET ?? "").trim().length > 0;
  return hasIpAllowlist || hasSecret;
}

export async function POST(request: NextRequest) {
  if (!isWebhookConfigured()) {
    logger.error("Dhan webhook request rejected: DHAN_WEBHOOK_IP_ALLOWLIST and DHAN_WEBHOOK_SECRET are both unset. Configure at least one to enable this endpoint.");
    return NextResponse.json(
      { ok: false, error: { code: "WEBHOOK_NOT_CONFIGURED", message: "Webhook authentication is not configured." } },
      { status: 503 }
    );
  }

  const ip = getRequestIp(request);
  if (!isAllowedIp(ip)) {
    return NextResponse.json({ ok: false, error: { code: "IP_NOT_ALLOWED", message: "Webhook IP is not allowed." } }, { status: 403 });
  }
  if (!isWebhookSecretValid(request)) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_WEBHOOK_SECRET", message: "Webhook secret validation failed." } },
      { status: 401 }
    );
  }

  let payload: unknown = {};
  try {
    payload = await request.json();
    const parsed = webhookSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: { code: "INVALID_PAYLOAD", message: "Webhook payload validation failed." } }, { status: 422 });
    }
  } catch {
    return NextResponse.json({ ok: false, error: { code: "INVALID_JSON", message: "Webhook request must be JSON." } }, { status: 400 });
  }

  setImmediate(() => {
    logger.info("Dhan webhook received", {
      orderId: (payload as { orderId?: string | number }).orderId ?? null,
      orderStatus: (payload as { orderStatus?: string }).orderStatus ?? null
    });
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
