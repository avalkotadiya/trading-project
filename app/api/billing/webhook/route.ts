import crypto from "crypto";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit";
import { isDatabaseConfigured } from "@/lib/auth";
import { hasRealEnvValue } from "@/lib/env";
import { logger } from "@/lib/logger";

// Minimal types for the Razorpay webhook payload shapes we handle.
type RazorpayPaymentEntity = {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
  email?: string;
  contact?: string;
};

type RazorpayWebhookEvent = {
  event: string;
  payload: {
    payment?: { entity: RazorpayPaymentEntity };
  };
};

function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  // timingSafeEqual requires same-length buffers
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!hasRealEnvValue(secret)) {
    return fail("WEBHOOK_DISABLED", "Razorpay webhook is not configured.", 501);
  }

  // Read raw body for signature verification before parsing JSON
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature") ?? "";

  if (!signature) {
    return fail("MISSING_SIGNATURE", "Webhook signature header is missing.", 400);
  }

  if (!verifySignature(rawBody, signature, secret!)) {
    logger.warn("Razorpay webhook signature mismatch", { signature });
    return fail("INVALID_SIGNATURE", "Webhook signature verification failed.", 401);
  }

  let event: RazorpayWebhookEvent;
  try {
    event = JSON.parse(rawBody) as RazorpayWebhookEvent;
  } catch {
    return fail("INVALID_PAYLOAD", "Webhook payload is not valid JSON.", 400);
  }

  logger.info("Razorpay webhook received", { event: event.event });

  switch (event.event) {
    case "payment.captured": {
      const payment = event.payload.payment?.entity;
      if (!payment) break;

      await handlePaymentCaptured(payment, request);
      break;
    }

    case "payment.failed": {
      const payment = event.payload.payment?.entity;
      if (!payment) break;

      await handlePaymentFailed(payment, request);
      break;
    }

    default:
      // Acknowledge unhandled events without error so Razorpay doesn't retry
      logger.info("Razorpay webhook: unhandled event", { event: event.event });
  }

  return ok({ received: true });
}

async function handlePaymentCaptured(payment: RazorpayPaymentEntity, request: NextRequest) {
  if (!isDatabaseConfigured()) return;

  const invoice = await prisma.invoice.findFirst({
    where: { providerRef: payment.order_id },
  });

  if (!invoice) {
    logger.warn("Razorpay payment.captured: no matching invoice", { orderId: payment.order_id });
    return;
  }

  if (invoice.status === "PAID") return; // idempotent — already processed

  await prisma.$transaction([
    prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: "PAID",
        paidAt: new Date(),
        // Store Razorpay payment ID alongside the original order ID
        providerRef: payment.id,
      },
    }),
    ...(invoice.subscriptionId
      ? [
          prisma.userSubscription.update({
            where: { id: invoice.subscriptionId },
            data: {
              status: "ACTIVE",
              currentPeriodStart: new Date(),
              currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
          }),
        ]
      : []),
  ]);

  void writeAuditLog({
    userId: invoice.userId,
    actorEmail: "razorpay-webhook",
    action: "billing.payment_captured",
    entity: "Invoice",
    entityId: invoice.id,
    metadata: {
      orderId: payment.order_id,
      paymentId: payment.id,
      amountPaisa: payment.amount,
    },
    request,
  });
}

async function handlePaymentFailed(payment: RazorpayPaymentEntity, request: NextRequest) {
  if (!isDatabaseConfigured()) return;

  const invoice = await prisma.invoice.findFirst({
    where: { providerRef: payment.order_id, status: "OPEN" },
  });

  if (!invoice) return;

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { status: "FAILED" },
  });

  void writeAuditLog({
    userId: invoice.userId,
    actorEmail: "razorpay-webhook",
    action: "billing.payment_failed",
    entity: "Invoice",
    entityId: invoice.id,
    metadata: { orderId: payment.order_id, paymentId: payment.id },
    request,
  });
}
