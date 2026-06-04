import { randomUUID } from "node:crypto";
import { DhanClient } from "@/services/dhan/dhanClient";
import { resolveDhanAccessToken } from "@/services/dhan/dhanAuth";
import { dhanModifyOrderPayloadSchema, dhanOrderPayloadSchema } from "@/services/dhan/dhanSchemas";

export type PlaceOrderInput = typeof dhanOrderPayloadSchema._type;
export const placeOrderValidationSchema = dhanOrderPayloadSchema;

export class DhanOrdersService {
  private readonly client = new DhanClient(resolveDhanAccessToken);

  validatePlaceOrder(input: unknown) {
    return dhanOrderPayloadSchema.safeParse(input);
  }

  validateModifyOrder(input: unknown) {
    return dhanModifyOrderPayloadSchema.safeParse(input);
  }

  async placeOrder(input: PlaceOrderInput) {
    return this.client.post("/orders", {
      ...input,
      correlationId: input.correlationId || randomUUID()
    });
  }

  async sliceOrder(input: PlaceOrderInput) {
    return this.client.post("/orders/slicing", {
      ...input,
      correlationId: input.correlationId || randomUUID()
    });
  }

  async modifyOrder(orderId: string, input: Record<string, unknown>) {
    return this.client.put(`/orders/${encodeURIComponent(orderId)}`, input);
  }

  async cancelOrder(orderId: string) {
    return this.client.delete(`/orders/${encodeURIComponent(orderId)}`);
  }

  async listOrders() {
    return this.client.get("/orders");
  }

  async getOrder(orderId: string) {
    return this.client.get(`/orders/${encodeURIComponent(orderId)}`);
  }

  async getOrderByCorrelationId(correlationId: string) {
    return this.client.get(`/orders/external/${encodeURIComponent(correlationId)}`);
  }

  async getTrades() {
    return this.client.get("/trades");
  }

  async getTradesByOrder(orderId: string) {
    return this.client.get(`/trades/${encodeURIComponent(orderId)}`);
  }
}

export const dhanOrdersService = new DhanOrdersService();
