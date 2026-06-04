import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit";
import { getAuthenticatedUser, isDatabaseConfigured, UnauthorizedError } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { alertStatusSchema } from "@/lib/validators";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const limit = await rateLimit(request, "alerts:update", { limit: 30 });

  if (!limit.allowed) {
    return fail("RATE_LIMITED", "Too many alert updates.", 429);
  }

  try {
    const { id } = await context.params;
    const payload = await request.json();
    const parsed = alertStatusSchema.safeParse(payload);

    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Alert status payload is invalid.", 422, parsed.error.flatten());
    }

    const user = await getAuthenticatedUser();

    if (!isDatabaseConfigured()) {
      return fail("DATABASE_NOT_CONFIGURED", "Database is required to update alerts.", 503);
    }

    const result = await prisma.alert.updateMany({
      where: { id, userId: user.id },
      data: { status: parsed.data.status }
    });

    if (result.count === 0) {
      return fail("NOT_FOUND", "Alert was not found.", 404);
    }

    const alert = await prisma.alert.findFirst({
      where: { id, userId: user.id }
    });

    await writeAuditLog({
      userId: user.id,
      actorEmail: user.email,
      action: "alert.update",
      entity: "Alert",
      entityId: id,
      metadata: { status: parsed.data.status },
      request
    });

    return ok({ alert, mode: "database" });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return fail("UNAUTHORIZED", error.message, 401);
    }

    return fail("ALERT_UPDATE_FAILED", "Unable to update alert.", 500);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const limit = await rateLimit(request, "alerts:delete", { limit: 30 });

  if (!limit.allowed) {
    return fail("RATE_LIMITED", "Too many alert deletes.", 429);
  }

  try {
    const { id } = await context.params;
    const user = await getAuthenticatedUser();

    if (!isDatabaseConfigured()) {
      return fail("DATABASE_NOT_CONFIGURED", "Database is required to delete alerts.", 503);
    }

    const result = await prisma.alert.deleteMany({
      where: { id, userId: user.id }
    });

    if (result.count === 0) {
      return fail("NOT_FOUND", "Alert was not found.", 404);
    }

    await writeAuditLog({
      userId: user.id,
      actorEmail: user.email,
      action: "alert.delete",
      entity: "Alert",
      entityId: id,
      request
    });

    return ok({ deleted: true, id, mode: "database" });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return fail("UNAUTHORIZED", error.message, 401);
    }

    return fail("ALERT_DELETE_FAILED", "Unable to delete alert.", 500);
  }
}
