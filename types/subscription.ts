export type BillingInterval = "month" | "year";

export type SubscriptionPlan = {
  key: "free" | "pro";
  name: string;
  priceInr: number;
  interval: BillingInterval;
  description: string;
  features: string[];
  highlighted?: boolean;
};

export type SubscriptionState = {
  planKey: "free" | "pro" | null;
  planName: string | null;
  status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  /**
   * True when the Pro entitlement is granted by role rather than a paid
   * subscription. Plan-gating logic doesn't need to read this — it only
   * checks planKey. The UI uses it (and adminGrantRole below) to label the
   * badge so a privileged user can tell elevated access is role-based.
   */
  isAdminGrant?: boolean;
  /**
   * Which role granted the access — lets the UI badge OWNER as "Pro · Owner"
   * (rank 5, highest) vs ADMIN as "Pro · Admin" (rank 4). Only set when
   * isAdminGrant === true.
   */
  adminGrantRole?: "ADMIN" | "OWNER";
};
