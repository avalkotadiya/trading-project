import { SUBSCRIPTION_PLANS } from "@/lib/constants";
import { hasRealEnvValue } from "@/lib/env";

export async function createRazorpayOrder(planKey: "free" | "pro", billingInterval: "month" | "year") {
  const plan = SUBSCRIPTION_PLANS.find((item) => item.key === planKey);

  if (!plan) {
    throw new Error("Unknown subscription plan.");
  }

  const amount = billingInterval === "year" ? plan.priceInr * 10 : plan.priceInr;

  if (!hasRealEnvValue(process.env.RAZORPAY_KEY_ID) || !hasRealEnvValue(process.env.RAZORPAY_KEY_SECRET)) {
    throw new Error("Razorpay credentials are not configured.");
  }

  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
  
  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      amount: amount * 100, // Razorpay expects amount in paisa
      currency: "INR",
      receipt: `rcpt_${plan.key}_${Date.now()}`
    })
  });

  if (!response.ok) {
    throw new Error("Failed to create Razorpay order.");
  }

  const data = (await response.json()) as { id: string };

  return {
    provider: "razorpay",
    orderId: data.id,
    amount,
    currency: "INR",
    message: "Order created successfully."
  };
}
