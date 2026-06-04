import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  workers: 1,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } }
    },
    {
      name: "tablet",
      use: { ...devices["iPad Pro 11"], browserName: "chromium", viewport: { width: 834, height: 1194 } }
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], browserName: "chromium", viewport: { width: 412, height: 915 } }
    }
  ]
});
