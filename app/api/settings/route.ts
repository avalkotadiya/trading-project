import type { NextRequest } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit";
import { getAuthenticatedUser, isDatabaseConfigured, UnauthorizedError } from "@/lib/auth";
import { getUserSettingsProfile } from "@/lib/platform-data";
import { rateLimit } from "@/lib/rate-limit";
import { settingsSchema } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, "settings", { limit: 40 });

  if (!limit.allowed) {
    return fail("RATE_LIMITED", "Too many settings requests.", 429);
  }

  try {
    const profile = await getUserSettingsProfile();
    return ok({ profile });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return fail("UNAUTHORIZED", error.message, 401);
    }

    return fail("SETTINGS_FETCH_FAILED", "Unable to load settings.", 500);
  }
}

export async function PATCH(request: NextRequest) {
  const limit = await rateLimit(request, "settings:update", { limit: 20 });

  if (!limit.allowed) {
    return fail("RATE_LIMITED", "Too many settings updates.", 429);
  }

  try {
    const payload = await request.json();
    const parsed = settingsSchema.safeParse(payload);

    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Settings payload is invalid.", 422, parsed.error.flatten());
    }

    const user = await getAuthenticatedUser();

    if (!isDatabaseConfigured()) {
      return fail("DATABASE_NOT_CONFIGURED", "Database is required to update settings.", 503);
    }

    const data: Prisma.UserUpdateInput = {
      name: parsed.data.name,
      phoneNumber: parsed.data.phoneNumber,
      telegramChatId: parsed.data.telegramChatId,
      whatsappOptIn: parsed.data.whatsappOptIn,
      emailAlerts: parsed.data.emailAlerts,
      pushAlerts: parsed.data.pushAlerts,
      weeklyDigest: parsed.data.weeklyDigest
    };

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data
    });

    await writeAuditLog({
      userId: user.id,
      actorEmail: user.email,
      action: "settings.update",
      entity: "User",
      entityId: user.id,
      request
    });

    return ok({
      profile: {
        id: updatedUser.id,
        name: updatedUser.name ?? "Sahara Trader",
        email: updatedUser.email,
        role: updatedUser.role,
        phoneNumber: updatedUser.phoneNumber,
        telegramChatId: updatedUser.telegramChatId,
        whatsappOptIn: updatedUser.whatsappOptIn,
        emailAlerts: updatedUser.emailAlerts,
        pushAlerts: updatedUser.pushAlerts,
        weeklyDigest: updatedUser.weeklyDigest
      },
      mode: "database"
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return fail("UNAUTHORIZED", error.message, 401);
    }

    return fail("SETTINGS_UPDATE_FAILED", "Unable to update settings.", 500);
  }
}
