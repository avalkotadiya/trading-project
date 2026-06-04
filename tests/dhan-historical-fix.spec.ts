import { test, expect } from "@playwright/test";

test.describe("Dhan historical DH-905 fix", () => {
  test("authenticated POST /api/dhan/historical does not return DH-905", async ({ page }) => {
    // 1) Sign up to get a session cookie.
    const email = `dhan-smoke+${Date.now()}@example.com`;
    const password = "smoke-pass-1234";
    const signUp = await page.request.post("/api/auth/sign-up", {
      data: { name: "Smoke", email, password },
      headers: { "Content-Type": "application/json" }
    });
    expect(signUp.status(), `sign-up: ${await signUp.text()}`).toBeLessThan(400);

    // 2) Daily candles for RELIANCE — a guaranteed-listed NSE EQ symbol.
    // RELIANCE securityId on Dhan v2 is "2885" (mapped in DHAN_DASHBOARD_INSTRUMENTS).
    const today = new Date();
    const aWeekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const toDate = today.toISOString().slice(0, 10);
    const fromDate = aWeekAgo.toISOString().slice(0, 10);

    const resp = await page.request.post("/api/dhan/historical", {
      data: {
        securityId: "2885",
        exchangeSegment: "NSE_EQ",
        instrument: "EQUITY",
        fromDate,
        toDate
      },
      headers: { "Content-Type": "application/json" }
    });

    const body = await resp.json().catch(async () => ({ raw: await resp.text() }));
    const errCode = body?.error?.code as string | undefined;
    const errMsg = body?.error?.message as string | undefined;
    const errDetails = JSON.stringify(body?.error?.details ?? {});

    // The fix-confirming check: the upstream "DH-905 Missing required fields"
    // must NOT appear. Other errors (404 for delisted, 429 throttled, even 200)
    // all confirm we got past the validation layer.
    const isDH905 =
      errCode === "DH-905" ||
      /Missing required fields/i.test(errMsg ?? "") ||
      /DH-905/.test(errDetails);

    expect(isDH905, `Dhan still rejects with DH-905 — body: ${JSON.stringify(body).slice(0, 600)}`).toBe(false);

    console.log(`historical response: ${resp.status()} — code=${errCode ?? "ok"} msg=${errMsg ?? "—"}`);
  });
});
