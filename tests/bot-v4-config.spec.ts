import { test, expect } from "@playwright/test";

test.setTimeout(60_000);

test("bot v4 config — wallet cap + new feature fields round-trip", async ({ page }) => {
  // 1) Sign up.
  const email = `bot-v4+${Date.now()}@example.com`;
  const signUp = await page.request.post("/api/auth/sign-up", {
    data: { name: "V4 Smoke", email, password: "smoke-pass-1234" },
    headers: { "Content-Type": "application/json" }
  });
  expect(signUp.status(), `sign-up: ${await signUp.text()}`).toBeLessThan(400);

  // 2) GET defaults — schema should expose the new fields.
  const initial = await page.request.get("/api/bot/config");
  expect(initial.status()).toBe(200);
  const initialBody = await initial.json();
  console.log(`initial config: ${JSON.stringify(initialBody.data)}`);
  expect(initialBody.data).toMatchObject({
    autoTradeEnabled: false,
    maxDeployedCapital: expect.any(Number),
    botTrailStartPct: expect.any(Number),
    botTrailDistancePct: expect.any(Number),
    botMaxSectorExposurePct: expect.any(Number)
  });
  // Legacy field shouldn't leak into response.
  expect(initialBody.data).not.toHaveProperty("minAutoTradeAmount");
  expect(initialBody.data).not.toHaveProperty("maxAutoTradeAmount");

  // 3) PATCH all new fields at once.
  const patch = await page.request.patch("/api/bot/config", {
    headers: { "Content-Type": "application/json" },
    data: {
      autoTradeEnabled: true,
      maxDeployedCapital: 75000,
      botTrailStartPct: 3.5,
      botTrailDistancePct: 2,
      botMaxSectorExposurePct: 0.35,
      botEntryWindowStart: "10:00",
      botEntryWindowEnd: "13:30"
    }
  });
  expect(patch.status(), `patch: ${await patch.text()}`).toBe(200);
  const patchBody = await patch.json();
  expect(patchBody.data).toMatchObject({
    autoTradeEnabled: true,
    maxDeployedCapital: 75000,
    botTrailStartPct: 3.5,
    botTrailDistancePct: 2,
    botMaxSectorExposurePct: 0.35,
    botEntryWindowStart: "10:00",
    botEntryWindowEnd: "13:30"
  });

  // 4) Validation — bad HH:MM should be rejected.
  const badWindow = await page.request.patch("/api/bot/config", {
    headers: { "Content-Type": "application/json" },
    data: { botEntryWindowStart: "9:5" }
  });
  expect(badWindow.status()).toBe(422);

  // 5) Validation — end <= start should be rejected.
  const reverseWindow = await page.request.patch("/api/bot/config", {
    headers: { "Content-Type": "application/json" },
    data: { botEntryWindowStart: "14:00", botEntryWindowEnd: "13:30" }
  });
  expect(reverseWindow.status()).toBe(422);
});
