import type { NextRequest } from "next/server";
import { AlertType } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit";
import { getAuthenticatedUser, isDatabaseConfigured, UnauthorizedError } from "@/lib/auth";
import { getAlertSummaries, mapAlertRecord } from "@/lib/platform-data";
import { rateLimit } from "@/lib/rate-limit";
import { alertSchema } from "@/lib/validators";
import { dispatchAlertNotifications } from "@/services/notifications";

const alertTypeMap: Record<"price" | "volume" | "momentum", AlertType> = {
  price: "PRICE",
  volume: "VOLUME",
  momentum: "MOMENTUM"
};

export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, "alerts", { limit: 80 });

  if (!limit.allowed) {
    return fail("RATE_LIMITED", "Too many alert requests.", 429);
  }

  try {
    if (!isDatabaseConfigured()) {
      return ok({ alerts: [], mode: "unconfigured" });
    }

    await getAuthenticatedUser();

    const alerts = await getAlertSummaries(25);
    return ok({ alerts, mode: "database" });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return fail("UNAUTHORIZED", error.message, 401);
    }

    return fail("ALERT_FETCH_FAILED", "Unable to load alerts.", 500);
  }
}

export async function POST(request: NextRequest) {
  const limit = await rateLimit(request, "alerts:create", { limit: 30 });

  if (!limit.allowed) {
    return fail("RATE_LIMITED", "Too many alert writes.", 429);
  }

  try {
    const payload = await request.json();
    const parsed = alertSchema.safeParse(payload);

    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Alert payload is invalid.", 422, parsed.error.flatten());
    }

    const user = await getAuthenticatedUser();

    if (!isDatabaseConfigured()) {
      return fail("DATABASE_NOT_CONFIGURED", "Database is required to create alerts.", 503);
    }

    const alert = await prisma.alert.create({
      data: {
        userId: user.id,
        symbol: parsed.data.symbol,
        type: alertTypeMap[parsed.data.type],
        condition: parsed.data.condition,
        targetPrice: parsed.data.targetPrice,
        message: parsed.data.message
      }
    });
    const mappedAlert = mapAlertRecord(alert);
    const notifications = await dispatchAlertNotifications(mappedAlert, user);

    await writeAuditLog({
      userId: user.id,
      actorEmail: user.email,
      action: "alert.create",
      entity: "Alert",
      entityId: alert.id,
      metadata: { notifications },
      request
    });

    return ok({ alert: mappedAlert, notifications, mode: "database" }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return fail("UNAUTHORIZED", error.message, 401);
    }

    return fail("ALERT_CREATE_FAILED", "Unable to create alert.", 500);
  }
}
