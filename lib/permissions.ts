import { fail } from "@/lib/api-response";
import type { AuthenticatedAppUser } from "@/lib/auth";

const roleRank = {
  VIEWER: 1,
  TRADER: 2,
  ANALYST: 3,
  ADMIN: 4,
  OWNER: 5
} as const;

export function hasRole(user: Pick<AuthenticatedAppUser, "role">, minimumRole: keyof typeof roleRank) {
  return roleRank[user.role] >= roleRank[minimumRole];
}

export function requireRole(user: Pick<AuthenticatedAppUser, "role">, minimumRole: keyof typeof roleRank) {
  if (!hasRole(user, minimumRole)) {
    throw new Error("FORBIDDEN");
  }
}

export function forbiddenResponse() {
  return fail("FORBIDDEN", "You do not have permission to access this resource.", 403);
}
