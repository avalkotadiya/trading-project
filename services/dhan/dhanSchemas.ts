import { z } from "zod";
import {
  DHAN_CHART_EXCHANGE_SEGMENTS,
  DHAN_CHART_INSTRUMENTS,
  DHAN_CHART_INTERVALS
} from "@/services/dhan/dhanChartValidation";

export const dhanExchangeSegmentSchema = z.enum(DHAN_CHART_EXCHANGE_SEGMENTS);

export const dhanTransactionTypeSchema = z.enum(["BUY", "SELL"]);
export const dhanProductTypeSchema = z.enum(["CNC", "INTRADAY", "MARGIN", "MTF", "CO", "BO"]);
export const dhanOrderTypeSchema = z.enum(["LIMIT", "MARKET", "STOP_LOSS", "STOP_LOSS_MARKET"]);
export const dhanValiditySchema = z.enum(["DAY", "IOC"]);
export const dhanInstrumentSchema = z.enum(DHAN_CHART_INSTRUMENTS);

export const dhanOrderPayloadSchema = z.object({
  dhanClientId: z.string().min(4),
  transactionType: dhanTransactionTypeSchema,
  exchangeSegment: dhanExchangeSegmentSchema,
  productType: dhanProductTypeSchema,
  orderType: dhanOrderTypeSchema,
  validity: dhanValiditySchema,
  securityId: z.string().min(1),
  quantity: z.number().int().positive(),
  disclosedQuantity: z.number().int().nonnegative().optional(),
  price: z.number().nonnegative().optional(),
  triggerPrice: z.number().nonnegative().optional(),
  afterMarketOrder: z.boolean().optional(),
  amoTime: z.string().optional(),
  boProfitValue: z.number().nonnegative().optional(),
  boStopLossValue: z.number().nonnegative().optional(),
  correlationId: z.string().max(64).optional(),
  confirmOrder: z.literal(true)
});

export const dhanModifyOrderPayloadSchema = z.object({
  dhanClientId: z.string().min(4).optional(),
  orderId: z.string().optional(),
  orderType: dhanOrderTypeSchema.optional(),
  legName: z.string().optional(),
  quantity: z.number().int().positive().optional(),
  price: z.number().nonnegative().optional(),
  disclosedQuantity: z.number().int().nonnegative().optional(),
  triggerPrice: z.number().nonnegative().optional(),
  validity: dhanValiditySchema.optional()
});

export const dhanHistoricalPayloadSchema = z.object({
  securityId: z.string().min(1),
  exchangeSegment: dhanExchangeSegmentSchema,
  instrument: dhanInstrumentSchema,
  expiryCode: z.number().int().optional(),
  interval: z.enum(DHAN_CHART_INTERVALS).optional(),
  oi: z.boolean().default(false),
  fromDate: z.string().min(8),
  toDate: z.string().min(8)
});

export const dhanMarginPayloadSchema = z.object({
  dhanClientId: z.string().min(4),
  exchangeSegment: dhanExchangeSegmentSchema,
  transactionType: dhanTransactionTypeSchema,
  quantity: z.number().int().positive(),
  productType: dhanProductTypeSchema,
  securityId: z.string().min(1),
  price: z.number().nonnegative().optional(),
  triggerPrice: z.number().nonnegative().optional()
});

export const dhanMultiMarginPayloadSchema = z.object({
  dhanClientId: z.string().min(4),
  includePosition: z.boolean().default(true),
  includeOrder: z.boolean().default(true),
  scripList: z.array(dhanMarginPayloadSchema.omit({ dhanClientId: true })).min(1).max(50)
});

export const dhanConvertPositionPayloadSchema = z.object({
  dhanClientId: z.string().min(4),
  fromProductType: dhanProductTypeSchema,
  exchangeSegment: dhanExchangeSegmentSchema,
  positionType: z.enum(["LONG", "SHORT"]),
  securityId: z.string().min(1),
  tradingSymbol: z.string().min(1),
  convertQty: z.number().int().positive(),
  toProductType: dhanProductTypeSchema
});

export const webhookSchema = z
  .object({
    orderId: z.union([z.string(), z.number()]).optional(),
    orderStatus: z.string().optional()
  })
  .passthrough();
