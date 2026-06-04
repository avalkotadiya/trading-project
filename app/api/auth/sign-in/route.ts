import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit";
import { createSession, clearSession } from "@/lib/session";
import { authRateLimit } from "@/lib/auth-rate-limit";
import { signInSchema } from "@/lib/validators";
import { verifyPassword } from "@/lib/password";
import { findAuthUserByEmail } from "@/lib/auth-user";

const DUMMY_PASSWORD_HASH =
  "scrypt:8f1b8f9ea53d2b6d5a3c4e290adce1f7:6a8c1e9f6c2d4b7a9f3d1e5b7a9c2d4e6f8a1b3c5d7e9f1a3b5c7d9e1f3a5b7a6c8e0f2a4c6e8b0d2f4a6c8e0f2a4c";

export async function POST(request: NextRequest) {
  try {
    const limit = await authRateLimit(request, "sign-in", 12, 60);
    if (!limit.allowed) {
      return fail("RATE_LIMITED", "Too many sign-in attempts. Please wait a minute and try again.", 429);
    }

    const payload = await request.json();
    const parsed = signInSchema.safeParse(payload);

    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Enter a valid email and password.", 422, parsed.error.flatten());
    }

    const user = await findAuthUserByEmail(parsed.data.email);

    // Constant-time pattern to reduce user-enumeration timing leakage.
    const hashForVerification = user?.passwordHash || DUMMY_PASSWORD_HASH;
    const validPassword = await verifyPassword(parsed.data.password, hashForVerification);

    if (!user || !validPassword) {
      return fail("INVALID_CREDENTIALS", "Email or password is incorrect.", 401);
    }

    await clearSession();
    await createSession(user.id);
    
    // Background the audit log so it doesn't block the response
    // writeAuditLog handles its own catch and backgrounding logic internally
    writeAuditLog({
      userId: user.id,
      actorEmail: user.email,
      action: "auth.sign_in",
      entity: "User",
      entityId: user.id,
      request
    });

    return ok({
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    });
  } catch {
    return fail("SIGN_IN_FAILED", "Unable to sign in right now.", 500);
  }
}
