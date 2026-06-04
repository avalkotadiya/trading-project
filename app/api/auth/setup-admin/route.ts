import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, UnauthorizedError } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";

/**
 * Admin Setup Route
 * 
 * Allows the first user of the system to claim the "OWNER" role.
 * Once an OWNER exists in the database, this route becomes locked.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser();

    if (user.role === "OWNER") {
      return NextResponse.json({ ok: true, message: "You are already the owner." });
    }

    // Atomic conditional update: only promotes this user if NO owner exists yet.
    // Prevents the TOCTOU race where two simultaneous requests both see ownerCount=0.
    const updatedUser = await prisma.$transaction(async (tx) => {
      const ownerCount = await tx.user.count({ where: { role: "OWNER" } });
      if (ownerCount > 0) return null;
      return tx.user.update({ where: { id: user.id }, data: { role: "OWNER" } });
    });

    if (!updatedUser) {
      return NextResponse.json(
        { ok: false, error: "An owner account already exists. This route is locked." },
        { status: 403 }
      );
    }

    await writeAuditLog({
      userId: user.id,
      actorEmail: user.email,
      action: "admin.setup",
      entity: "User",
      entityId: user.id,
      metadata: { previousRole: user.role, newRole: "OWNER" },
      request
    });

    return NextResponse.json({
      ok: true,
      message: "Successfully claimed the OWNER role.",
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        role: updatedUser.role
      }
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: "Failed to setup admin account." }, { status: 500 });
  }
}
