import { test, expect } from "@playwright/test";

test("after the previous test populated the edge cache, candidates are non-empty", async ({ page }) => {
  const signUp = await page.request.post("/api/auth/sign-up", {
    data: { name: "Readback", email: `readback+${Date.now()}@example.com`, password: "smoke-pass-1234" },
    headers: { "Content-Type": "application/json" }
  });
  expect(signUp.status()).toBeLessThan(400);

  const resp = await page.request.get("/api/bot/state?candidates=cache");
  expect(resp.status()).toBe(200);
  const body = await resp.json();
  const candidates = body?.data?.candidates as Array<{ symbol: string; compositeScore: number }> | undefined;
  console.log(`candidates: ${candidates?.length ?? 0}`);
  if ((candidates ?? []).length > 0) {
    const top = candidates![0];
    console.log(`top: ${top.symbol} score=${top.compositeScore}`);
  }
  expect((candidates ?? []).length).toBeGreaterThan(0);
});
