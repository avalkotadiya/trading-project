import { prisma } from "@/lib/prisma";

export const authUserSelect = {
  id: true,
  clerkId: true,
  email: true,
  name: true,
  imageUrl: true,
  role: true,
  phoneNumber: true,
  telegramChatId: true,
  whatsappOptIn: true,
  emailAlerts: true,
  pushAlerts: true,
  weeklyDigest: true,
  passwordHash: true
} as const;

export async function findAuthUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email },
    select: authUserSelect
  });
}

export async function findSessionUserById(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      clerkId: true,
      email: true,
      name: true,
      imageUrl: true,
      role: true,
      phoneNumber: true,
      telegramChatId: true,
      whatsappOptIn: true,
      emailAlerts: true,
      pushAlerts: true,
      weeklyDigest: true
    }
  });
}

