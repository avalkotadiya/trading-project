import { test, expect } from "@playwright/test";

const PROTECTED = [
  "/dashboard",
  "/portfolio",
  "/scanner-pro",
  "/options",
  "/charts",
  "/analytics",
  "/orders",
  "/billing",
  "/settings",
  "/insider-strategy"
];

test.describe("authenticated runtime smoke", () => {
  test("sign up then walk protected pages", async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(`[${page.url()}] ${msg.text()}`);
      }
    });
    page.on("pageerror", (err) => {
      pageErrors.push(`[${page.url()}] ${err.message}\n${err.stack ?? ""}`);
    });
    page.on("requestfailed", (req) => {
      const url = req.url();
      const errText = req.failure()?.errorText ?? "";
      // Any same-origin request aborted by the browser on navigation
      // (long-lived SSE, poll-loop fetches, iframe loads) — expected, not a bug.
      if (errText === "net::ERR_ABORTED") return;
      failedRequests.push(`[${page.url()}] ${req.method()} ${url} — ${errText}`);
    });
    page.on("response", async (resp) => {
      if (resp.status() >= 500) {
        let body = "";
        try { body = (await resp.text()).slice(0, 400); } catch {}
        failedRequests.push(`[${page.url()}] HTTP ${resp.status()} ${resp.url()} — ${body}`);
      }
    });

    const email = `smoke+${Date.now()}@example.com`;
    const password = "smoke-pass-1234";

    // 1) Sign up via API (server-side cookie set on response).
    const signUpResp = await page.request.post("/api/auth/sign-up", {
      data: { name: "Smoke User", email, password },
      headers: { "Content-Type": "application/json" }
    });
    const signUpBody = await signUpResp.text();
    console.log(`sign-up: ${signUpResp.status()} ${signUpBody.slice(0, 200)}`);
    expect(signUpResp.status(), `sign-up status (body: ${signUpBody})`).toBeLessThan(400);

    // 2) Walk the protected routes, collecting client-side errors.
    for (const path of PROTECTED) {
      console.log(`navigating to ${path}`);
      const resp = await page.goto(path, { waitUntil: "domcontentloaded" });
      console.log(`  ${path} -> HTTP ${resp?.status()}`);
      // small settle wait so client effects have a chance to run
      await page.waitForTimeout(2000);
    }

    if (pageErrors.length || consoleErrors.length || failedRequests.length) {
      const report = [
        pageErrors.length ? "PAGE ERRORS:\n" + pageErrors.join("\n---\n") : "",
        consoleErrors.length ? "CONSOLE ERRORS:\n" + consoleErrors.join("\n---\n") : "",
        failedRequests.length ? "FAILED REQUESTS / 5xx:\n" + failedRequests.join("\n---\n") : ""
      ].filter(Boolean).join("\n\n");
      throw new Error(report);
    }
  });
});
