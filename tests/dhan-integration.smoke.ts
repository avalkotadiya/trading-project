import assert from "node:assert/strict";
import { placeOrderValidationSchema } from "@/services/dhan/dhanOrders";
import { webhookSchema } from "@/services/dhan/dhanSchemas";
import { dhanAuthService } from "@/services/dhan/dhanAuth";
import { dhanMarketFeedService } from "@/services/dhan/dhanMarketFeed";

async function run() {
  const orderValid = placeOrderValidationSchema.safeParse({
    dhanClientId: "1111111111",
    transactionType: "BUY",
    exchangeSegment: "NSE_EQ",
    productType: "INTRADAY",
    orderType: "MARKET",
    validity: "DAY",
    securityId: "1333",
    quantity: 1,
    confirmOrder: true
  });
  assert.equal(orderValid.success, true, "Expected valid order payload to pass");

  const orderInvalid = placeOrderValidationSchema.safeParse({
    dhanClientId: "1111111111",
    quantity: 1
  });
  assert.equal(orderInvalid.success, false, "Expected invalid order payload to fail");

  const webhookValid = webhookSchema.safeParse({ orderId: "abc", orderStatus: "TRADED", anything: true });
  assert.equal(webhookValid.success, true, "Expected webhook payload to pass");

  const authHealth = await dhanAuthService.getTokenHealth();
  assert.equal(typeof authHealth.configured, "boolean");

  const marketStatus = dhanMarketFeedService.getStatus();
  assert.equal(typeof marketStatus.connected, "boolean");

  console.log("Dhan smoke checks passed.");
}

void run();
