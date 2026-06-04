# Sahara Trade Intelligence

Sahara Trade Intelligence is a fintech SaaS MVP for trading intelligence, scanners, options analytics, alerts, portfolio tracking, billing, and admin workflows. Market data now flows through a backend-only provider adapter layer designed for licensed NSE/BSE feeds or authorized vendors.

## Compliance Notice

- Use licensed NSE/BSE market data only.
- Do not scrape NSE or BSE websites.
- Do not use unofficial exchange APIs for production.
- Exchange data redistribution can require explicit exchange or vendor permission.
- Production deployment requires a valid NSE/BSE/vendor agreement and access controls before paid feed data is exposed to users.
- Vendor credentials must stay server-side. The frontend connects only to Sahara APIs or the Sahara WebSocket gateway.

## Tech Stack

- Next.js 15 App Router
- React 19
- TypeScript
- Tailwind CSS
- Clerk Auth or built-in database auth
- Prisma ORM and PostgreSQL
- Redis or Upstash REST cache
- Backend market-data provider adapters
- Backend WebSocket gateway
- TradingView widget embed
- Razorpay checkout placeholder

## Folder Structure

```txt
.
|-- app
|   |-- (auth)
|   |-- (dashboard)
|   |-- api
|   |   `-- market
|   |       |-- health
|   |       |-- overview
|   |       |-- snapshot
|   |       |-- subscribe
|   |       |-- symbols/search
|   |       |-- ticks
|   |       `-- unsubscribe
|   |-- layout.tsx
|   `-- page.tsx
|-- components
|-- data
|   `-- symbol-master.sample.json
|-- deploy/k8s
|-- hooks
|-- lib
|-- prisma
|-- public
|-- server
|-- services
|   `-- market-data
|       |-- providers
|       |   |-- bse.provider.ts
|       |   |-- globaldatafeeds.provider.ts
|       |   |-- mock.provider.ts
|       |   |-- nse.provider.ts
|       |   `-- truedata.provider.ts
|       |-- market-cache.service.ts
|       |-- market-data.config.ts
|       |-- market-data.guard.ts
|       |-- market-data.service.ts
|       |-- market-data.types.ts
|       |-- market-websocket.gateway.ts
|       |-- subscription-manager.service.ts
|       |-- symbol-mapper.service.ts
|       `-- tick-normalizer.service.ts
|-- styles
|-- tests
|-- types
`-- utils
```

## Setup

```bash
npm install
cp .env.example .env.local
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Open `http://localhost:3000`.

## Mock Market Mode

Mock mode needs no paid credentials:

```env
MARKET_DATA_PROVIDER=dhan
NEXT_PUBLIC_MARKET_WS_URL=ws://localhost:3001/ws
REALTIME_PORT=3001
```

Run the Next app:

```bash
npm run dev
```

Optionally run the backend WebSocket gateway:

```bash
npm run realtime:dev
```

If `NEXT_PUBLIC_MARKET_WS_URL` is not set, the dashboard safely falls back to polling `/api/market/ticks` once per second.

## Licensed Provider Setup

Choose one provider:

```env
MARKET_DATA_PROVIDER=nse
# or bse, truedata, globaldatafeeds
```

Official NSE placeholder:

```env
NSE_FEED_HOST=
NSE_FEED_PORT=
NSE_FEED_USERNAME=
NSE_FEED_PASSWORD=
```

Official BSE placeholder:

```env
BSE_FEED_HOST=
BSE_FEED_PORT=
BSE_FEED_USERNAME=
BSE_FEED_PASSWORD=
```

Vendor placeholders:

```env
TRUEDATA_API_KEY=
TRUEDATA_WS_URL=
GLOBALDATAFEEDS_API_KEY=
GLOBALDATAFEEDS_WS_URL=
```

The provider placeholders validate credentials and fail closed until the licensed feed parser or vendor SDK implementation is added. They never return fake production data.

## Environment Variables

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_replace_me
CLERK_SECRET_KEY=sk_test_replace_me
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sahara_trade?schema=public
PRISMA_CONNECTION_LIMIT=1
OWNER_EMAILS=founder@example.com
ADMIN_EMAILS=admin@example.com
POSTGRES_PRISMA_URL=postgresql://USER:PASSWORD@HOST:6543/postgres?sslmode=require&pgbouncer=true
POSTGRES_URL_NON_POOLING=postgresql://USER:PASSWORD@HOST:5432/postgres?sslmode=require
POSTGRES_URL=postgresql://USER:PASSWORD@HOST:6543/postgres?sslmode=require

REDIS_URL=
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=replace_me
REDIS_REST_URL=https://your-redis.upstash.io
REDIS_REST_TOKEN=replace_me

MARKET_DATA_PROVIDER=dhan
MARKET_DATA_ALLOWED_SEGMENTS=NSE_EQ,NSE_FNO,BSE_EQ,BSE_FNO
NEXT_PUBLIC_MARKET_WS_URL=ws://localhost:3001/ws
REALTIME_PORT=3001
NSE_FEED_HOST=
NSE_FEED_PORT=
NSE_FEED_USERNAME=
NSE_FEED_PASSWORD=
BSE_FEED_HOST=
BSE_FEED_PORT=
BSE_FEED_USERNAME=
BSE_FEED_PASSWORD=
TRUEDATA_API_KEY=
TRUEDATA_WS_URL=
GLOBALDATAFEEDS_API_KEY=
GLOBALDATAFEEDS_WS_URL=

RAZORPAY_KEY_ID=rzp_test_replace_me
RAZORPAY_KEY_SECRET=replace_me
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_replace_me
AI_SIGNAL_PROVIDER=rule_engine
AUDIT_LOG_MODE=async
TELEGRAM_BOT_TOKEN=replace_me
TELEGRAM_DEFAULT_CHAT_ID=replace_me
WHATSAPP_ACCESS_TOKEN=replace_me
WHATSAPP_PHONE_NUMBER_ID=replace_me
WHATSAPP_DEFAULT_RECIPIENT=replace_me
MONITORING_TOKEN=replace_me
```

## Market Data Flow

```txt
Licensed exchange/vendor feed
  -> backend provider adapter
  -> tick normalizer
  -> Redis/cache layer
  -> Sahara API and WebSocket gateway
  -> authenticated frontend dashboard
```

The frontend receives live ticks from `NEXT_PUBLIC_MARKET_WS_URL` when the backend gateway is running. Without that gateway, it polls the protected Sahara API. It never connects directly to NSE, BSE, TrueData, Global Datafeeds, or any other vendor.

## Redis Cache

The market cache stores:

- `market:tick:{exchange}:{symbol}`
- `market:snapshot:{exchange}:{symbol}`
- `market:subscriptions`
- `market:provider:health`

`REDIS_URL` uses a standard Redis connection for Docker/Kubernetes. `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are supported for Vercel/serverless. If no Redis is configured, the app uses an in-memory development cache.

## Market API Routes

- `GET /api/market/overview`
- `GET /api/market/snapshot?exchange=NSE&symbol=RELIANCE`
- `GET /api/market/ticks?symbols=NSE:RELIANCE,NSE:TCS,BSE:500325`
- `POST /api/market/subscribe`
- `POST /api/market/unsubscribe`
- `GET /api/market/health`
- `GET /api/market/symbols/search?q=reliance`

When `MARKET_DATA_PROVIDER` is not `mock`, market tick, snapshot, subscribe, unsubscribe, and overview endpoints require an authenticated user.

## Verification

```bash
npm install
npm run lint
npm run typecheck
npm run build
```

Run Playwright smoke tests after starting the local server:

```bash
npm run test:e2e
```

## Deployment

1. Configure PostgreSQL and run Prisma migrations.
2. Configure Redis or Upstash for market cache.
3. Configure only licensed market-data provider credentials.
4. Run `npm run build`.
5. Deploy the Next app to Vercel or Kubernetes.
6. Run `server/realtime-server.ts` as a separate WebSocket service for live streaming.
7. Add the WebSocket service URL to `NEXT_PUBLIC_MARKET_WS_URL`.
8. Ensure CSP allows the WebSocket gateway origin.

## Scalability Options

- Add the approved NSE multicast parser or vendor SDK inside the provider adapter.
- Split ingestion, normalization, cache writes, and WebSocket fanout into separate workers.
- Move subscription entitlement checks into a dedicated billing gate.
- Use Redis pub/sub or streams for multi-instance WebSocket fanout.
- Add persistent audit events for market-data access and redistribution controls.
