import { test, expect } from "@playwright/test";

const ROUTES = ["/", "/sign-in", "/sign-up"];

test.describe("runtime smoke", () => {
  for (const path of ROUTES) {
    test(`renders ${path} without console/page errors`, async ({ page }) => {
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      const failedRequests: string[] = [];

      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });
      page.on("pageerror", (err) => pageErrors.push(err.message + "\n" + (err.stack ?? "")));
      page.on("requestfailed", (req) => {
        const url = req.url();
        if (url.includes("/_next/") || url.includes(":3000")) {
          failedRequests.push(`${req.method()} ${url} — ${req.failure()?.errorText}`);
        }
      });

      const response = await page.goto(path, { waitUntil: "networkidle" });
      expect(response?.status(), `status for ${path}`).toBeLessThan(400);

      // Give client a moment to settle and hydrate.
      await page.waitForTimeout(1500);

      if (pageErrors.length || consoleErrors.length || failedRequests.length) {
        const report = [
          `=== ${path} ===`,
          pageErrors.length ? "PAGE ERRORS:\n" + pageErrors.join("\n---\n") : "",
          consoleErrors.length ? "CONSOLE ERRORS:\n" + consoleErrors.join("\n---\n") : "",
          failedRequests.length ? "FAILED REQUESTS:\n" + failedRequests.join("\n") : ""
        ].filter(Boolean).join("\n\n");
        throw new Error(report);
      }
    });
  }
});
