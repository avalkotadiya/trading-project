import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/auth-config";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { findSessionUserById } from "@/lib/auth-user";

/**
 * Hashing token for storage provides an extra layer of security
 */
export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

const fallbackSessionStore = new Map<string, { userId: string; expiresAt: number }>();
const FALLBACK_MAX_ENTRIES = 10_000;

function evictExpiredFallbackSessions() {
  const now = Date.now();
  for (const [key, entry] of fallbackSessionStore) {
    if (entry.expiresAt <= now) {
      fallbackSessionStore.delete(key);
    }
    // Stop early — avoid scanning the full map on every call
    if (fallbackSessionStore.size <= FALLBACK_MAX_ENTRIES / 2) break;
  }
}

function setFallbackSession(hashedToken: string, userId: string, expiresAt: number) {
  if (fallbackSessionStore.size >= FALLBACK_MAX_ENTRIES) {
    evictExpiredFallbackSessions();
    // If still at limit after eviction, reject — Redis must be restored
    if (fallbackSessionStore.size >= FALLBACK_MAX_ENTRIES) return;
  }
  fallbackSessionStore.set(hashedToken, { userId, expiresAt });
}

/**
 * Enhanced Cookie Configuration
 */
function getSecureCookieOptions(token: string) {
  const isProduction = process.env.NODE_ENV === "production";
  const isVercel = process.env.VERCEL === "1";
  
  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "strict" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure: isProduction || isVercel,
    priority: "high" as const
  };
}

/**
 * Create a new secure session.
 */
export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const hashedToken = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  
  let wroteRedis = false;
  try {
    await redis.set(`session:${hashedToken}`, userId, "EX", SESSION_MAX_AGE_SECONDS);
    wroteRedis = true;
  } catch {
    // Redis unavailable. Continue with DB-backed session fallback.
  }

  if (!wroteRedis) {
    await prisma.authSession.create({
      data: {
        userId,
        tokenHash: hashedToken,
        expiresAt
      }
    });
    setFallbackSession(hashedToken, userId, expiresAt.getTime());
  }

  const cookieStore = await cookies();
  cookieStore.set(getSecureCookieOptions(token));

  return { token };
}

/**
 * Retrieves and validates the session.
 * NOTE: We do NOT set cookies here because this function is often called 
 * during Server Component rendering where cookie modification is forbidden.
 */
export const getSessionUser = cache(async () => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) return null;

  const hashedToken = hashToken(token);
  let userId: string | null = null;

  try {
    userId = await redis.get(`session:${hashedToken}`);
  } catch {
    // Ignore and fallback to DB/memory session lookup.
  }

  if (!userId) {
    const local = fallbackSessionStore.get(hashedToken);
    if (local && local.expiresAt > Date.now()) {
      userId = local.userId;
    } else {
      const session = await prisma.authSession.findUnique({
        where: { tokenHash: hashedToken },
        select: { userId: true, expiresAt: true }
      });

      if (session && session.expiresAt > new Date()) {
        userId = session.userId;
      }
    }
  }

  if (!userId) {
    try {
      cookieStore.delete(SESSION_COOKIE_NAME);
    } catch {}
    return null;
  }

  return findSessionUserById(userId);
});

/**
 * Refresh the session expiry (Rolling Session).
 * This should be called from Middleware or Route Handlers where cookie modification is allowed.
 */
export async function refreshSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) return;

  const hashedToken = hashToken(token);
  let userId: string | null = null;
  try {
    userId = await redis.get(`session:${hashedToken}`);
    if (userId) {
      await redis.expire(`session:${hashedToken}`, SESSION_MAX_AGE_SECONDS);
    }
  } catch {
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
    await prisma.authSession.updateMany({
      where: { tokenHash: hashedToken, expiresAt: { gt: new Date() } },
      data: { expiresAt }
    });
    const local = fallbackSessionStore.get(hashedToken);
    if (local) {
      setFallbackSession(hashedToken, local.userId, expiresAt.getTime());
      userId = local.userId;
    }
  }

  if (userId) {
    try {
      cookieStore.set(getSecureCookieOptions(token));
    } catch {}
  }
}

/**
 * Securely terminates the session.
 */
export async function clearSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    const hashedToken = hashToken(token);
    try {
      await redis.del(`session:${hashedToken}`);
    } catch {}
    fallbackSessionStore.delete(hashedToken);
    await prisma.authSession.deleteMany({ where: { tokenHash: hashedToken } });
  }

  try {
    cookieStore.delete(SESSION_COOKIE_NAME);
  } catch {
    // Ignore
  }
}
