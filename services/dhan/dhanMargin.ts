import { DhanClient } from "@/services/dhan/dhanClient";
import { resolveDhanAccessToken } from "@/services/dhan/dhanAuth";

export class DhanMarginService {
  private readonly client = new DhanClient(resolveDhanAccessToken);

  async calculate(payload: Record<string, unknown>) {
    return this.client.post("/margincalculator", payload);
  }

  async calculateMulti(payload: Record<string, unknown>) {
    return this.client.post("/margincalculator/multi", payload);
  }

  async fundLimit() {
    return this.client.get("/fundlimit");
  }
}

export const dhanMarginService = new DhanMarginService();
