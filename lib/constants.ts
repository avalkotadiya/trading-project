import type { SubscriptionPlan } from "@/types/subscription";

export const APP_NAME = "Sahara Trade Intelligence";

export const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Charts", href: "/charts" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Scanner", href: "/scanner-pro" },
  { label: "Insider", href: "/insider-strategy" },
  { label: "Options", href: "/options" },
  { label: "Analytics", href: "/analytics" },
  { label: "Billing", href: "/billing" },
  { label: "Settings", href: "/settings" },
  { label: "Admin", href: "/admin", adminOnly: true }
] as const;

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    key: "free",
    name: "Free",
    priceInr: 0,
    interval: "month",
    description: "For watchlists, market overview, and delayed scanner signals.",
    features: [
      "5 watchlist symbols",
      "Market overview dashboard",
      "Basic scanner filters",
      "Email alert preferences"
    ]
  },
  {
    key: "pro",
    name: "Pro",
    priceInr: 1499,
    interval: "month",
    description: "For active traders who need faster signals and options context.",
    features: [
      "Unlimited watchlists",
      "Realtime DhanHQ market feed",
      "Advanced scanner signals",
      "Options analytics widgets",
      "Priority alert delivery"
    ],
    highlighted: true
  }
];

export const DASHBOARD_SYMBOLS = [
  // Indices
  "NSE:NIFTY",
  "NSE:BANKNIFTY",
  "BSE:SENSEX",
  // Large-cap NSE equities — expanded to 26 stocks so the bot has more
  // candidates to choose from when trying to fully deploy the user's range.
  "NSE:RELIANCE",
  "NSE:TCS",
  "NSE:INFY",
  "NSE:HDFCBANK",
  "NSE:ICICIBANK",
  "NSE:SBIN",
  "NSE:AXISBANK",
  "NSE:KOTAKBANK",
  "NSE:BAJFINANCE",
  "NSE:BAJAJFINSV",
  "NSE:LT",
  "NSE:TITAN",
  "NSE:MARUTI",
  "NSE:SUNPHARMA",
  "NSE:DRREDDY",
  "NSE:BHARTIARTL",
  "NSE:WIPRO",
  "NSE:HCLTECH",
  "NSE:TECHM",
  "NSE:TATAMOTORS",
  "NSE:TATASTEEL",
  "NSE:HINDALCO",
  "NSE:JSWSTEEL",
  "NSE:ITC",
  "NSE:NESTLEIND",
  "NSE:ONGC",
  "NSE:POWERGRID",
];
