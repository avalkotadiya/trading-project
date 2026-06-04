import { auth, currentUser } from "@clerk/nextjs/server";
import { isClerkConfigured } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/session";
import { cache } from "react";

export type AuthenticatedAppUser = {
  id: string;
  clerkId: string;
  email: string;
  name: string | null;
  imageUrl: string | null;
  role: "OWNER" | "ADMIN" | "ANALYST" | "TRADER" | "VIEWER";
  phoneNumber: string | null;
  telegramChatId: string | null;
  whatsappOptIn: boolean;
  emailAlerts: boolean;
  pushAlerts: boolean;
  weeklyDigest: boolean;
};

function mapUser(user: {
  id: string;
  clerkId: string;
  email: string;
  name: string | null;
  imageUrl: string | null;
  role?: "OWNER" | "ADMIN" | "ANALYST" | "TRADER" | "VIEWER";
  phoneNumber?: string | null;
  telegramChatId?: string | null;
  whatsappOptIn?: boolean;
  emailAlerts: boolean;
  pushAlerts: boolean;
  weeklyDigest: boolean;
}): AuthenticatedAppUser {
  return {
    id: user.id,
    clerkId: user.clerkId,
    email: user.email,
    name: user.name,
    imageUrl: user.imageUrl,
    role: user.role ?? "TRADER",
    phoneNumber: user.phoneNumber ?? null,
    telegramChatId: user.telegramChatId ?? null,
    whatsappOptIn: user.whatsappOptIn ?? false,
    emailAlerts: user.emailAlerts,
    pushAlerts: user.pushAlerts,
    weeklyDigest: user.weeklyDigest
  };
}

/**
 * Returns the role that should be assigned to a user at sign-in / upsert time.
 */
export function getConfiguredRoleForEmail(email: string): AuthenticatedAppUser["role"] {
  const owners = (process.env.OWNER_EMAILS ?? "").split(",").map(e => e.trim().toLowerCase());
  const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map(e => e.trim().toLowerCase());

  const lowerEmail = email.toLowerCase();
  
  if (owners.includes(lowerEmail)) return "OWNER";
  if (admins.includes(lowerEmail)) return "ADMIN";
  
  return "TRADER";
}

export function isDatabaseConfigured() {
  return true; // We now strictly require the database
}

export class UnauthorizedError extends Error {
  constructor(message = "Authentication is required.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export const getAuthenticatedUser = cache(async (): Promise<AuthenticatedAppUser> => {
  if (!isClerkConfigured()) {
    if (isDatabaseConfigured()) {
      const user = await getSessionUser();

      if (!user) {
        throw new UnauthorizedError();
      }

      return mapUser(user);
    }

    throw new UnauthorizedError();
  }

  const authState = await auth();

  if (!authState.userId) {
    throw new UnauthorizedError();
  }

  const clerkUser = await currentUser();
  const email =
    clerkUser?.emailAddresses[0]?.emailAddress ?? `${authState.userId}@sahara.local`;
  const name =
    [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(" ") ||
    clerkUser?.username ||
    "Sahara Trader";

  // We find existing user first to avoid overwriting manually assigned roles
  const existingUser = await prisma.user.findUnique({
    where: { clerkId: authState.userId }
  });

  const user = await prisma.user.upsert({
    where: { clerkId: authState.userId },
    update: {
      email,
      name,
      imageUrl: clerkUser?.imageUrl,
      // Only update role if it's currently TRADER and the new email suggests a higher role
      role: existingUser?.role && existingUser.role !== "TRADER" 
        ? existingUser.role 
        : getConfiguredRoleForEmail(email)
    },
    create: {
      clerkId: authState.userId,
      email,
      name,
      imageUrl: clerkUser?.imageUrl,
      role: getConfiguredRoleForEmail(email)
    }
  });

  return mapUser(user);
});
