/**
 * Audit log writer.
 *
 * Security fix: raw IP addresses are now hashed before storage to comply with
 * GDPR and India's DPDP Act — raw IPs constitute PII.
 *
 * Set IP_HASH_SALT in your environment. Rotating the salt effectively purges
 * all historical IP associations without deleting audit records.
 */

import type { NextRequest } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/auth";
import { hashIpAddress } from "@/lib/ip-hash";
import { logger } from "@/lib/logger";

type AuditInput = {
  userId?: string | null;
  actorEmail?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  request?: NextRequest;
};

export async function writeAuditLog(input: AuditInput) {
  if (!isDatabaseConfigured()) {
    return;
  }

  const rawIp =
    input.request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const task = prisma.auditLog
    .create({
      data: {
        userId: input.userId ?? undefined,
        actorEmail: input.actorEmail ?? undefined,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? undefined,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
        // IP is hashed — see lib/ip-hash.ts for details
        ipAddress: hashIpAddress(rawIp),
        userAgent: input.request?.headers.get("user-agent")
      }
    })
    .catch((error) => {
      logger.warn("Failed to write audit log", {
        action: input.action,
        entity: input.entity,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    });

  if (process.env.AUDIT_LOG_MODE === "sync") {
    await task;
    return;
  }

  void task;
}
