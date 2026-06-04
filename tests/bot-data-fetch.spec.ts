import { test, expect } from "@playwright/test";

test.setTimeout(360_000);

test("bot can fetch edge signals — DH-905 confirmation", async ({ page }) => {
  // 1) Sign up to get a session.
  const email = `bot-smoke+${Date.now()}@example.com`;
  const password = "smoke-pass-1234";
  const signUp = await page.request.post("/api/auth/sign-up", {
    data: { name: "Bot Smoke", email, password },
    headers: { "Content-Type": "application/json" }
  });
  expect(signUp.status(), `sign-up: ${await signUp.text()}`).toBeLessThan(400);

  // 2) Enable the bot so /api/bot/run actually runs a cycle.
  const cfgResp = await page.request.patch("/api/bot/config", {
    headers: { "Content-Type": "application/json" },
    data: { autoTradeEnabled: true, maxDeployedCapital: 50000 }
  });
  expect(cfgResp.status()).toBe(200);

  // 3) Trigger a cycle. This is what actually warms the quant-edge cache.
  //    A cold scan can take 60-120s while Dhan historical streams in
  //    under the throttle, so let it run.
  const cycleResp = await page.request.post("/api/bot/run", {
    headers: { "Content-Type": "application/json" },
    data: {},
    timeout: 300_000
  });
  console.log(`bot/run: ${cycleResp.status()}`);
  const cycleBody = await cycleResp.text();
  console.log(`bot/run body: ${cycleBody.slice(0, 600)}`);
  expect(cycleResp.status()).toBe(200);

  // 4) Read state using the cache (no scan).
  const stateResp = await page.request.get("/api/bot/state?candidates=cache");
  expect(stateResp.status()).toBe(200);
  const stateBody = await stateResp.json();
  const candidates = stateBody?.data?.candidates as unknown[] | undefined;
  console.log(`candidates count: ${candidates?.length ?? "n/a"}`);
  if (Array.isArray(candidates) && candidates.length > 0) {
    const first = candidates[0] as { symbol?: string; price?: number; compositeScore?: number };
    console.log(`top candidate: ${first.symbol} @ ${first.price} score=${first.compositeScore}`);
  }

  // The smoke pass condition: candidates array has at least one entry. If
  // Dhan was still rejecting historical with DH-905, quant-edge would
  // return [] and candidates would be empty.
  expect(candidates, "no candidates — bot is still unable to fetch data").toBeDefined();
  expect((candidates ?? []).length, "candidates array is empty").toBeGreaterThan(0);
});
