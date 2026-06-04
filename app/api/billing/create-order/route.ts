import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit";
import { getAuthenticatedUser, isDatabaseConfigured, UnauthorizedError } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { billingOrderSchema } from "@/lib/validators";
import { createRazorpayOrder } from "@/services/razorpay";

export async function POST(request: NextRequest) {
  const limit = await rateLimit(request, "billing:create-order", { limit: 20 });

  if (!limit.allowed) {
    return fail("RATE_LIMITED", "Too many checkout attempts.", 429);
  }

  try {
    const user = await getAuthenticatedUser();

    const payload = await request.json();
    const parsed = billingOrderSchema.safeParse(payload);

    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Checkout payload is invalid.", 422, parsed.error.flatten());
    }

    let subscription = null;

    if (isDatabaseConfigured()) {
      const plan = await prisma.subscriptionPlan.findUnique({
        where: { key: parsed.data.planKey }
      });

      if (!plan) {
        return fail("PLAN_NOT_FOUND", "Subscription plan is unavailable.", 404);
      }

      await prisma.userSubscription.updateMany({
        where: {
          userId: user.id,
          status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] },
          planId: { not: plan.id }
        },
        data: {
          status: "CANCELED"
        }
      });

      const existing = await prisma.userSubscription.findFirst({
        where: { userId: user.id, planId: plan.id },
        orderBy: { updatedAt: "desc" }
      });

      const currentPeriodStart = new Date();
      const currentPeriodEnd =
        parsed.data.planKey === "pro"
          ? new Date(currentPeriodStart.getTime() + 30 * 24 * 60 * 60 * 1000)
          : null;

      subscription = existing
        ? await prisma.userSubscription.update({
            where: { id: existing.id },
            data: {
              status: parsed.data.planKey === "free" ? "ACTIVE" : "TRIALING",
              currentPeriodStart,
              currentPeriodEnd
            },
            include: {
              plan: {
                select: {
                  key: true,
                  name: true
                }
              }
            }
          })
        : await prisma.userSubscription.create({
            data: {
              userId: user.id,
              planId: plan.id,
              status: parsed.data.planKey === "free" ? "ACTIVE" : "TRIALING",
              currentPeriodStart,
              currentPeriodEnd
            },
            include: {
              plan: {
                select: {
                  key: true,
                  name: true
                }
              }
            }
          });
    }

    const order = await createRazorpayOrder(parsed.data.planKey, parsed.data.billingInterval);
    let invoice = null;

    if (isDatabaseConfigured()) {
      invoice = await prisma.invoice.create({
        data: {
          userId: user.id,
          subscriptionId: subscription?.id,
          amountInr: order.amount,
          status: parsed.data.planKey === "free" ? "PAID" : "OPEN",
          provider: order.provider,
          providerRef: order.orderId,
          paidAt: parsed.data.planKey === "free" ? new Date() : null
        }
      });
    }

    await writeAuditLog({
      userId: user.id,
      actorEmail: user.email,
      action: "billing.checkout",
      entity: "UserSubscription",
      entityId: subscription?.id,
      metadata: { planKey: parsed.data.planKey, orderId: order.orderId, invoiceId: invoice?.id },
      request
    });

    return ok({
      ...order,
      invoice,
      subscription: subscription
        ? {
            planKey: subscription.plan.key,
            planName: subscription.plan.name,
            status: subscription.status,
            currentPeriodStart: subscription.currentPeriodStart?.toISOString() ?? null,
            currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null
          }
        : {
            planKey: parsed.data.planKey,
            planName: parsed.data.planKey === "free" ? "Free" : "Pro",
            status: parsed.data.planKey === "free" ? "ACTIVE" : "TRIALING",
            currentPeriodStart: new Date().toISOString(),
            currentPeriodEnd: null
          }
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return fail("UNAUTHORIZED", error.message, 401);
    }

    return fail("CHECKOUT_FAILED", "Unable to initialize checkout.", 500);
  }
}
