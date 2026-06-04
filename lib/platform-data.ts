import type { Alert, SubscriptionStatus, TradingSignal, UserSubscription } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, isDatabaseConfigured, type AuthenticatedAppUser } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { SUBSCRIPTION_PLANS } from "@/lib/constants";
import type { FeaturedSignal, AlertSummary, UserSettingsProfile, WatchlistSummary } from "@/types/platform";
import type { SubscriptionState } from "@/types/subscription";
import { formatRelativeTime } from "@/utils/format";

/**
 * Admin & Owner roles always get the Pro entitlement, regardless of whether
 * they hold a paid subscription. Returning true here causes
 * resolveEffectiveSubscription to short-circuit to a synthetic Pro state.
 * Drives both UI gates (Pro badge, unlimited watchlist) and server gates
 * (watchlist POST cap) from a single check.
 */
export function isAdminGrantedPro(user: Pick<AuthenticatedAppUser, "role">): boolean {
  return hasRole(user, "ADMIN");
}

function adminGrantSubscription(role: "ADMIN" | "OWNER"): SubscriptionState {
  return {
    planKey: "pro",
    planName: "Pro",
    status: "ACTIVE",
    currentPeriodStart: new Date().toISOString(),
    currentPeriodEnd: null,
    isAdminGrant: true,
    adminGrantRole: role
  };
}

/**
 * Single resolver every caller should use to decide a user's effective
 * subscription. OWNER and ADMIN both see Pro. Everyone else sees their
 * mapped DB subscription, falling back to the default Free state.
 *
 * The OWNER role (rank 5 in lib/permissions.ts) is the highest — it already
 * inherits every `hasRole(user, "X")` gate by design. This resolver just
 * extends that inheritance to the plan/billing dimension, so OWNER (like
 * ADMIN) doesn't need a paid UserSubscription row to use Pro features.
 */
export function resolveEffectiveSubscription(
  user: Pick<AuthenticatedAppUser, "role">,
  dbSubscription: SubscriptionState | null
): SubscriptionState {
  if (user.role === "OWNER") return adminGrantSubscription("OWNER");
  if (user.role === "ADMIN") return adminGrantSubscription("ADMIN");
  return dbSubscription ?? getDefaultSubscriptionState();
}

function inferAlertTone(alert: Pick<Alert, "type" | "condition" | "status">): AlertSummary["tone"] {
  const condition = alert.condition.toLowerCase();

  if (alert.status === "PAUSED") {
    return "neutral";
  }

  if (condition.includes("below") || condition.includes("bear")) {
    return "negative";
  }

  if (condition.includes("above") || condition.includes("bull") || alert.type === "VOLUME") {
    return "positive";
  }

  return "neutral";
}

function buildAlertTitle(alert: Pick<Alert, "type" | "symbol" | "status">) {
  if (alert.status === "PAUSED") {
    return `${alert.symbol} alert paused`;
  }

  if (alert.type === "PRICE") {
    return `${alert.symbol} price alert`;
  }

  if (alert.type === "VOLUME") {
    return `${alert.symbol} volume alert`;
  }

  return `${alert.symbol} momentum alert`;
}

export function mapAlertRecord(alert: Alert): AlertSummary {
  return {
    id: alert.id,
    symbol: alert.symbol,
    title: buildAlertTitle(alert),
    message: alert.message ?? alert.condition,
    tone: inferAlertTone(alert),
    status: alert.status,
    type: alert.type,
    condition: alert.condition,
    createdAt: formatRelativeTime(alert.createdAt),
    _rawCreatedAt: alert.createdAt
  };
}

function mapSubscriptionState(
  subscription: (UserSubscription & { plan: { key: string; name: string } }) | null
): SubscriptionState | null {
  if (!subscription) {
    return null;
  }

  return {
    planKey: subscription.plan.key as SubscriptionState["planKey"],
    planName: subscription.plan.name,
    status: subscription.status,
    currentPeriodStart: subscription.currentPeriodStart?.toISOString() ?? null,
    currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null
  };
}

function pickCurrentSubscription<T extends { status: SubscriptionStatus; updatedAt: Date }>(subscriptions: T[]) {
  const score = { ACTIVE: 3, TRIALING: 2, PAST_DUE: 1, CANCELED: 0 } as const;

  return [...subscriptions].sort((left, right) => {
    const statusDiff = score[right.status] - score[left.status];

    if (statusDiff !== 0) {
      return statusDiff;
    }

    return right.updatedAt.getTime() - left.updatedAt.getTime();
  })[0] ?? null;
}

function getDefaultSubscriptionState(): SubscriptionState {
  return {
    planKey: "free",
    planName: "Free",
    status: "ACTIVE",
    currentPeriodStart: new Date().toISOString(),
    currentPeriodEnd: null
  };
}

function mapWatchlistSummaries(watchlists: { id: string; name: string; symbols: string[]; updatedAt: Date }[]) {
  return watchlists.map((watchlist) => ({
    id: watchlist.id,
    name: watchlist.name,
    symbols: watchlist.symbols,
    updatedAt: watchlist.updatedAt.toISOString()
  })) satisfies WatchlistSummary[];
}

export async function getWatchlistSummaries(): Promise<WatchlistSummary[]> {
  if (!isDatabaseConfigured()) {
    return [];
  }

  const user = await getAuthenticatedUser();
  const watchlists = await prisma.watchlist.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" }
  });

  return mapWatchlistSummaries(watchlists);
}

export async function getAlertSummaries(limit = 25): Promise<AlertSummary[]> {
  if (!isDatabaseConfigured()) {
    return [];
  }

  const user = await getAuthenticatedUser();
  
  // Fetch both user-defined alerts and global AI alerts
  const [userAlerts, aiAlerts] = await Promise.all([
    prisma.alert.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: limit
    }),
    prisma.aIAlert.findMany({
      orderBy: { createdAt: "desc" },
      take: limit
    })
  ]);

  const mappedUserAlerts = userAlerts.map(mapAlertRecord);
  const mappedAiAlerts: AlertSummary[] = aiAlerts.map(alert => ({
    id: alert.id,
    symbol: alert.symbol ?? "GLOBAL",
    title: `AI ${alert.type} Alert`,
    message: alert.message,
    tone: (alert.severity === "CRITICAL" || alert.severity === "HIGH") ? "negative" : "neutral",
    status: "ACTIVE",
    type: "MOMENTUM",
    condition: alert.action ?? "",
    createdAt: formatRelativeTime(alert.createdAt),
    _rawCreatedAt: alert.createdAt
  }));

  // Merge and sort by raw creation date
  return [...mappedUserAlerts, ...mappedAiAlerts]
    .sort((a, b) => {
      const dateA = a._rawCreatedAt?.getTime() ?? 0;
      const dateB = b._rawCreatedAt?.getTime() ?? 0;
      return dateB - dateA;
    })
    .slice(0, limit);
}

export async function getBillingOverview() {
  const plans = SUBSCRIPTION_PLANS;

  if (!isDatabaseConfigured()) {
    return {
      plans,
      currentSubscription: getDefaultSubscriptionState()
    };
  }

  const user = await getAuthenticatedUser();
  const subscriptions = await prisma.userSubscription.findMany({
    where: { userId: user.id },
    include: {
      plan: {
        select: {
          key: true,
          name: true
        }
      }
    },
    orderBy: { updatedAt: "desc" }
  });

  const currentSubscription = mapSubscriptionState(pickCurrentSubscription(subscriptions));

  return {
    plans,
    currentSubscription: resolveEffectiveSubscription(user, currentSubscription)
  };
}

export async function getDashboardData() {
  if (!isDatabaseConfigured()) {
    return {
      watchlists: await getWatchlistSummaries(),
      alerts: await getAlertSummaries(4),
      signal: await getFeaturedSignal(),
      billingOverview: await getBillingOverview()
    };
  }

  const user = await getAuthenticatedUser();
  const [watchlists, alerts, signal, subscriptions] = await Promise.all([
    prisma.watchlist.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" }
    }),
    prisma.alert.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 4
    }),
    prisma.tradingSignal.findFirst({
      orderBy: [{ confidence: "desc" }, { createdAt: "desc" }]
    }),
    prisma.userSubscription.findMany({
      where: { userId: user.id },
      include: {
        plan: {
          select: {
            key: true,
            name: true
          }
        }
      },
      orderBy: { updatedAt: "desc" }
    })
  ]);

  return {
    watchlists: mapWatchlistSummaries(watchlists),
    alerts: alerts.map(mapAlertRecord),
    signal: signal ? mapSignal(signal) : null,
    billingOverview: {
      plans: SUBSCRIPTION_PLANS,
      currentSubscription: resolveEffectiveSubscription(
        user,
        mapSubscriptionState(pickCurrentSubscription(subscriptions))
      )
    }
  };
}

export async function getUserSettingsProfile() {
  if (!isDatabaseConfigured()) {
    return {
      id: "local-user",
      name: "Local Trader",
      email: "local@saharatrade.local",
      role: "TRADER",
      phoneNumber: null,
      telegramChatId: null,
      whatsappOptIn: false,
      emailAlerts: true,
      pushAlerts: false,
      weeklyDigest: true
    } satisfies UserSettingsProfile;
  }

  const user = await getAuthenticatedUser();

  return {
    id: user.id,
    name: user.name ?? "Sahara Trader",
    email: user.email,
    role: user.role,
    phoneNumber: user.phoneNumber,
    telegramChatId: user.telegramChatId,
    whatsappOptIn: user.whatsappOptIn,
    emailAlerts: user.emailAlerts,
    pushAlerts: user.pushAlerts,
    weeklyDigest: user.weeklyDigest
  };
}

export async function getFeaturedSignal() {
  if (!isDatabaseConfigured()) {
    return null;
  }

  const signal = await prisma.tradingSignal.findFirst({
    orderBy: [{ confidence: "desc" }, { createdAt: "desc" }]
  });

  if (!signal) {
    return null;
  }

  return mapSignal(signal);
}

function mapSignal(signal: TradingSignal): FeaturedSignal {
  return {
    symbol: signal.symbol,
    direction: signal.direction,
    confidence: signal.confidence,
    strategy: signal.strategy,
    entryPrice: Number(signal.entryPrice),
    stopLoss: signal.stopLoss ? Number(signal.stopLoss) : null,
    targetPrice: signal.targetPrice ? Number(signal.targetPrice) : null,
    timeframe: signal.timeframe,
    summary: signal.summary
  };
}

export function getSymbolName(symbol: string) {
  return symbol;
}
