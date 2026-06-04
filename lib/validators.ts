import { z } from "zod";
import { sanitizeSymbol, sanitizeText } from "@/lib/sanitize";

export const watchlistSchema = z.object({
  name: z.string().min(2).max(60).transform((value) => sanitizeText(value, 60)),
  symbols: z
    .array(z.string().min(1).max(20))
    .min(1)
    .max(30)
    .transform((symbols) => symbols.map(sanitizeSymbol).filter(Boolean))
});

export const alertSchema = z.object({
  symbol: z.string().min(1).max(20).transform(sanitizeSymbol),
  type: z.enum(["price", "volume", "momentum"]),
  condition: z.string().min(2).max(120).transform((value) => sanitizeText(value, 120)),
  targetPrice: z.number().positive().optional(),
  message: z.string().max(180).optional().transform((value) => (value ? sanitizeText(value, 180) : value))
});

export const scannerQuerySchema = z.object({
  strategy: z.enum(["all", "volume", "momentum", "breakout", "gap", "reversal", "bullish", "bearish"]).default("all"),
  minRelativeVolume: z.coerce.number().min(0).max(20).default(1),
  signal: z.enum(["all", "bullish", "bearish", "neutral"]).default("all")
});

export const billingOrderSchema = z.object({
  planKey: z.enum(["free", "pro"]),
  billingInterval: z.enum(["month", "year"]).default("month")
});

export const alertStatusSchema = z.object({
  status: z.enum(["ACTIVE", "PAUSED"])
});

export const settingsSchema = z.object({
  name: z.string().min(2).max(80).transform((value) => sanitizeText(value, 80)),
  phoneNumber: z.string().max(32).optional().transform((value) => (value ? sanitizeText(value, 32) : value)),
  telegramChatId: z.string().max(64).optional().transform((value) => (value ? sanitizeText(value, 64) : value)),
  whatsappOptIn: z.boolean().optional(),
  emailAlerts: z.boolean(),
  pushAlerts: z.boolean(),
  weeklyDigest: z.boolean()
});

export const portfolioHoldingSchema = z.object({
  symbol: z.string().min(1).max(20).transform(sanitizeSymbol),
  quantity: z.coerce.number().positive().max(1_000_000),
  averagePrice: z.coerce.number().positive().max(10_000_000),
  lastPrice: z.coerce.number().positive().max(10_000_000).optional(),
  broker: z.string().max(80).optional().transform((value) => (value ? sanitizeText(value, 80) : value)),
  notes: z.string().max(180).optional().transform((value) => (value ? sanitizeText(value, 180) : value))
});

export const adminRoleSchema = z.object({
  role: z.enum(["OWNER", "ADMIN", "ANALYST", "TRADER", "VIEWER"])
});

export const signInSchema = z.object({
  email: z.string().email().max(160).transform((value) => value.toLowerCase().trim()),
  password: z.string().min(8).max(128)
});

export const signUpSchema = signInSchema.extend({
  name: z.string().min(2).max(80).transform((value) => sanitizeText(value, 80))
});

export const placeOrderSchema = z.object({
  symbol: z.string().min(1).max(20).transform(sanitizeSymbol),
  direction: z.enum(["BUY", "SELL"]),
  quantity: z.number().int().positive().max(100_000),
  orderType: z.enum(["MARKET", "LIMIT", "SL-M"]).default("MARKET"),
  price: z.number().positive().max(10_000_000).optional(),
  strategy: z.string().max(80).default("MANUAL").transform((v) => sanitizeText(v, 80))
});
