# DhanHQ v2 Integration

## Required Environment Variables

Add in `.env`:

- `DHAN_API_KEY`
- `DHAN_API_SECRET`
- `DHAN_API_KEY_DEV` (recommended)
- `DHAN_API_SECRET_DEV` (recommended)
- `DHAN_API_KEY_PROD` (recommended)
- `DHAN_API_SECRET_PROD` (recommended)
- `DHAN_CLIENT_ID`
- `DHAN_ACCESS_TOKEN` (optional if OAuth callback flow is used)
- `DHAN_REDIRECT_URL`
- `DHAN_POSTBACK_URL`
- `DHAN_WEBHOOK_IP_ALLOWLIST` (optional, comma-separated)
- `DHAN_WEBHOOK_SECRET` (optional, passed as `x-dhan-webhook-secret`)

## Dhan Dashboard Setup

- Redirect URL: set to your backend callback, for example:
- Local: `http://localhost:3000/api/dhan/auth/callback`
- Production: `https://your-domain.com/api/dhan/auth/callback`
  - Alias supported: `/auth/dhan/callback`
- Postback URL: set to:
  - Local: `http://localhost:3000/api/dhan/webhook`
  - Production: `https://your-domain.com/api/dhan/webhook`

Do not use localhost postback URL in production.

## API Routes Added

Auth:
- `POST /api/dhan/auth/consent`
- `GET /api/dhan/auth/callback`
- `GET /auth/dhan/callback` (alias route)

Orders and trades:
- `POST /api/dhan/orders/place`
- `PUT /api/dhan/orders/:orderId`
- `DELETE /api/dhan/orders/:orderId`
- `GET /api/dhan/orders`
- `GET /api/dhan/orders/:orderId`
- `GET /api/dhan/trades`

Market and streams:
- `POST /api/dhan/market/subscribe`
- `GET /api/dhan/market/status`
- `GET /api/dhan/stream` (SSE for live ticks + order updates)

### Dhan Market Subscribe Payload (v2-aligned)

`POST /api/dhan/market/subscribe`

```json
{
  "requestCode": 15,
  "instruments": [
    { "ExchangeSegment": "NSE_EQ", "SecurityId": "1333" },
    { "ExchangeSegment": "BSE_EQ", "SecurityId": "532540" }
  ]
}
```

Notes:
- `requestCode` supports `15` (Ticker), `17` (Quote), `21` (Full)
- service batches subscriptions internally in chunks of 100 instruments
- supports up to 5000 instruments per connection (Dhan v2)
- accepts tuple style too: `[1, "1333"]` where numeric exchange code is mapped as in DhanHQ-py
- binary market feed packets are decoded server-side into normalized JSON (`ticker`, `quote`, `oi`, `prev_close`, `full`)

Webhook:
- `POST /api/dhan/webhook`

## Local Development

1. Populate Dhan vars in `.env`.
2. Start app: `npm run dev`
3. Open Settings page and use **DhanHQ Integration** panel.
4. Click **Start Dhan Auth** to begin consent flow, or provide `DHAN_ACCESS_TOKEN` manually.

## Production Setup

1. Set all env variables in deployment platform.
2. Configure `DHAN_WEBHOOK_IP_ALLOWLIST`.
3. Configure `DHAN_WEBHOOK_SECRET` and send it in `x-dhan-webhook-secret`.
4. Ensure static outbound IP is configured if you place live orders.
5. Update Dhan dashboard redirect/postback URLs to production domain.

## Security Notes

- API secret and access token are never sent to frontend.
- Tokens are read from `DHAN_ACCESS_TOKEN` or runtime token file `data/runtime/dhan-token.json`.
- Runtime token file is gitignored.
- Order routes use backend auth and rate limits.
- Webhook supports IP allowlist.
- Webhook supports optional shared-secret header verification.
- Live order placement may require Dhan static IP whitelisting.
- Use separate development and production Dhan API keys/secrets to avoid accidental live trades.

## Testing

Run smoke checks:

```bash
npm run test:dhan
```

Covers:
- Auth service token-health path
- Order payload validation
- Webhook payload validation
- Market feed status contract

## Dhan v2 Reference

- API base: `https://api.dhan.co/v2`
- Auth base: `https://auth.dhan.co`
- Market feed ws: `wss://api-feed.dhan.co?version=2&token=ACCESS_TOKEN&clientId=CLIENT_ID&authType=2`
- Order update ws: `wss://api-order-update.dhan.co`
## Full DhanHQ Route Coverage

The server-side DhanHQ integration exposes these authenticated routes:

- `POST /api/dhan/connect` - connect market feed and order update sockets.
- `GET /api/dhan/market/status` - token, market feed, and order update health.
- `POST /api/dhan/market/subscribe` - subscribe to ticker, quote, or full packets with request codes `15`, `17`, `21`.
- `POST /api/dhan/historical` - daily or intraday candles. Include `interval` for intraday `1`, `5`, `15`, `25`, or `60`.
- `GET /api/dhan/portfolio` - combined holdings, positions, and funds sync.
- `GET /api/dhan/portfolio/holdings` - holdings.
- `GET /api/dhan/portfolio/positions` - open positions.
- `POST /api/dhan/portfolio/positions/convert` - convert delivery/intraday product type.
- `DELETE /api/dhan/portfolio/positions/exit-all` - exit all positions.
- `GET /api/dhan/funds` - fund limit.
- `POST /api/dhan/margin` - single-order margin calculator.
- `POST /api/dhan/margin/multi` - multi-order margin calculator.
- `GET /api/dhan/orders` - order book.
- `POST /api/dhan/orders` - place order.
- `POST /api/dhan/orders/slicing` - sliced order over freeze quantity.
- `GET /api/dhan/orders/{orderId}` - order status.
- `PUT /api/dhan/orders/{orderId}` - modify order.
- `DELETE /api/dhan/orders/{orderId}` - cancel order.
- `GET /api/dhan/orders/external/{correlationId}` - order status by correlation ID.
- `GET /api/dhan/trades` - trade book.
- `GET /api/dhan/trades/{orderId}` - trades by order ID.
- `POST /api/dhan/webhook` - order postback webhook.

Order placement, modification, cancellation, slicing, position conversion, and exit-all are guarded by `DHAN_ORDER_IP_ALLOWLIST` because Dhan currently requires whitelisted static IPs for order APIs.
