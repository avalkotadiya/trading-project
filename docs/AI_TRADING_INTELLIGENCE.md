# AI Trading Intelligence

This project now includes a calibrated AI decision-support layer for DhanHQ-powered trading workflows. It does not claim guaranteed accuracy. Predictions are scored with confidence, risk, reliability, backtest health, and guardrails.

## API

`POST /api/ai/trading-intelligence`

Request:

```json
{
  "symbol": "RELIANCE",
  "accountEquity": 100000,
  "accountRiskPercent": 1,
  "securityId": "optional-dhan-security-id",
  "exchangeSegment": "NSE_EQ"
}
```

Response includes:

- `prediction.direction`
- `prediction.confidence`
- `prediction.riskScore`
- `prediction.entryZone`
- `prediction.stopLoss`
- `prediction.targets`
- `prediction.positionSize`
- `prediction.technicals`
- `prediction.sentiment`
- `prediction.portfolioRisk`
- `prediction.orderPreview`
- `prediction.modelHealth`
- `prediction.backtest`

## Modules

- `services/ai/feature-engineering.service.ts` calculates RSI, MACD, Bollinger Bands, EMA, ATR, VWAP, volume spikes, support/resistance, gap, candle pattern, and market-depth imbalance.
- `services/ai/prediction.service.ts` combines technical, sentiment, portfolio risk, model health, and backtest data into a single trade intelligence object.
- `services/ai/risk-engine.service.ts` connects portfolio concentration, drawdown, and exposure to confidence and position sizing.
- `services/orders/smart-order-manager.service.ts` creates a Dhan-ready order preview with guardrails and correlation ID.
- `components/dashboard/ai-trading-cockpit.tsx` displays the interconnected workflow in the dashboard.

## DhanHQ Configuration

Use server-side environment variables only:

```env
DHAN_CLIENT_ID=
DHAN_ACCESS_TOKEN=
DHAN_API_BASE_URL=https://api.dhan.co/v2
DHAN_AUTH_BASE_URL=https://auth.dhan.co
DHAN_WS_URL=wss://api-feed.dhan.co
DHAN_AUTO_SUBSCRIBE_JSON=
```

Order placement must still validate margin, live price, user risk settings, exchange segment, security ID, market hours, and static IP requirements before execution.

## AI Quant Bot Automation

The dashboard AI Quant Bot now has three execution modes:

- Manual cycle: `POST /api/bot/run`
- Browser loop: the dashboard Auto toggle repeats cycles while the page is open.
- Server automation: `GET` or `POST /api/bot/cron`, guarded by `Authorization: Bearer <CRON_SECRET>` or `Bearer <MONITORING_TOKEN>`.

`vercel.json` schedules `/api/bot/cron` every 5 minutes during weekday market hours in UTC (`*/5 4-10 * * 1-5`). Adjust this if you deploy outside Vercel or want a different cadence.

Live DhanHQ orders are intentionally double-gated:

```env
BROKER_PROVIDER=DHAN
DHAN_BOT_LIVE_TRADING_ENABLED=true
DHAN_BOT_PRODUCT_TYPE=INTRADAY
BOT_COOLDOWN_MINUTES=10
BOT_INTRADAY_INTERVAL=5
CRON_SECRET=<long-random-secret>
```

The user must also switch the dashboard bot mode to `LIVE`. Until then, trades remain paper fills. The bot uses DhanHQ daily history, intraday candles, and live quotes to calculate expected value, win rate, payoff ratio, Half-Kelly sizing, ATR stop/target, intraday pullback state, relative volume, and current P&L.

## Gemini Intelligence

Set these server-side variables to enable narrative AI review on top of deterministic scoring:

```env
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
```

The Gemini layer uses the Interactions API with `store=false` and only receives the already-calculated trading context: signal direction, risk score, technical indicators, sentiment, portfolio risk, model health, and backtest summary. It does not receive Dhan access tokens and it does not place trades.

If Gemini is unavailable, the endpoint returns the deterministic prediction and marks `geminiInsight.available` as `false`.
