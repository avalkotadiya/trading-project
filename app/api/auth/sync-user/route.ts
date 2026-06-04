import { ok, fail } from "@/lib/api-response";
import { getAuthenticatedUser, UnauthorizedError } from "@/lib/auth";

export async function POST() {
  try {
    const user = await getAuthenticatedUser();

    return ok({
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return fail("UNAUTHORIZED", error.message, 401);
    }

    return fail("SYNC_FAILED", "Unable to sync the authenticated user.", 500);
  }
}
