import { createServer } from "node:http";
import { marketDataService } from "@/services/market-data/market-data.service";
import { MarketWebSocketGateway } from "@/services/market-data/market-websocket.gateway";
import { logger } from "@/lib/logger";

const port = Number(process.env.REALTIME_PORT ?? 3001);
const server = createServer(async (request, response) => {
  if (request.url === "/health") {
    const health = await marketDataService.healthCheck();
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "sahara-market-data", health }));
    return;
  }

  response.writeHead(404);
  response.end();
});

const gateway = new MarketWebSocketGateway(server, marketDataService);

gateway.start();
server.listen(port, () => {
  logger.info(`Sahara market data websocket gateway listening on :${port}`);
});

async function shutdown() {
  await gateway.close();
  server.close();
}

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
