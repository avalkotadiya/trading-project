import { expect, test, type Page } from "@playwright/test";

function uniqueEmail(prefix: string) {
  return `${prefix}+${Date.now()}-${Math.round(Math.random() * 1_000_000)}@example.com`;
}

async function signUp(page: Page, email = uniqueEmail("qa")) {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("QA Trader");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("StrongPass123!");
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  return email;
}

async function expectNoBodyOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth
  }));

  expect(overflow.scrollWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width + 2);
  expect(overflow.bodyScrollWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width + 2);
}

test("auth, dashboard actions, and settings work", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);

  const email = await signUp(page);

  const symbolSearch = page.getByLabel("Search symbols");
  if (await symbolSearch.isVisible()) {
    await symbolSearch.fill("INFY");
    await symbolSearch.press("Enter");
    await expect(page).toHaveURL(/\/scanner\?query=INFY/);
    await expect(page.getByRole("heading", { name: "Volume and momentum signals" })).toBeVisible();
    await page.getByRole("link", { name: /dashboard|home/i }).click();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  }

  await page.getByRole("link", { name: /portfolio/i }).click();
  await expect(page.getByRole("heading", { name: "Portfolio" })).toBeVisible();
  await page.getByPlaceholder("Symbol").fill("SBIN");
  await page.getByPlaceholder("Quantity").fill("12");
  await page.getByPlaceholder("Average price").fill("800");
  await page.getByRole("button", { name: /save holding/i }).click();
  await expect(page.getByText("Holding saved.")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("link", { name: /dashboard|home/i }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await page.getByPlaceholder("Watchlist name").fill("QA Momentum");
  await page.getByPlaceholder("Symbols, comma separated").fill("NIFTY, TCS");
  await page.getByRole("button", { name: /add watchlist/i }).click();
  await expect(page.getByText("Watchlist saved.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("QA Momentum")).toBeVisible();

  await page.getByRole("link", { name: /alerts/i }).click();
  await expect(page.getByRole("heading", { name: "Alert center" })).toBeVisible();
  await page.getByPlaceholder("Symbol").fill("INFY");
  await page.getByPlaceholder("Condition").fill("price above 1600");
  await page.getByRole("button", { name: /save alert/i }).click();
  await expect(page.getByText("Alert created.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("INFY", { exact: true }).first()).toBeVisible();

  await page.getByRole("link", { name: /billing/i }).click();
  await expect(page.getByRole("heading", { name: "Plans and billing" })).toBeVisible();
  await page.getByRole("button", { name: /start pro/i }).click();
  await expect(page.getByText(/Order:/)).toBeVisible({ timeout: 30_000 });

  await page.getByRole("link", { name: /settings/i }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await page.getByLabel("Name").fill("QA Trader Updated");
  await page.getByRole("switch", { name: /push alerts/i }).click();
  await page.getByRole("button", { name: /save profile/i }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: /toggle theme/i }).first().click();
  await expect(page.locator("body")).toHaveClass(/light/);

  await page.getByRole("button", { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/sign-in/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("StrongPass123!");
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("key pages render without page-level horizontal overflow", async ({ page }, testInfo) => {
  await signUp(page, uniqueEmail(`qa-${testInfo.project.name}`));

  for (const path of ["/dashboard", "/portfolio", "/scanner-pro", "/options", "/alerts", "/analytics", "/billing", "/settings"]) {
    await page.goto(path, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("domcontentloaded");
    await expectNoBodyOverflow(page);
  }
});

test("landing and auth screens are usable on every viewport", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sahara Trade Intelligence" })).toBeVisible();
  await expectNoBodyOverflow(page);

  await page.getByRole("link", { name: /sign up/i }).first().click();
  await expect(page).toHaveURL(/\/sign-up/);
  await expect(page.getByRole("button", { name: /create account/i })).toBeVisible();
  await expectNoBodyOverflow(page);

  await page.getByRole("link", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("button", { name: /^sign in$/i })).toBeVisible();
  await expectNoBodyOverflow(page);
});
