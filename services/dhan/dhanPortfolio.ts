import { DhanClient } from "@/services/dhan/dhanClient";
import { resolveDhanAccessToken } from "@/services/dhan/dhanAuth";

export class DhanPortfolioService {
  private readonly client = new DhanClient(resolveDhanAccessToken);

  async holdings() {
    return this.client.get("/holdings");
  }

  async positions() {
    return this.client.get("/positions");
  }

  async convertPosition(payload: Record<string, unknown>) {
    return this.client.post("/positions/convert", payload);
  }

  async exitAllPositions() {
    return this.client.delete("/positions");
  }

  async funds() {
    return this.client.get("/fundlimit");
  }
}

export const dhanPortfolioService = new DhanPortfolioService();
