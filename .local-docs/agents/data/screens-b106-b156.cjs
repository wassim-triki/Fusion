#!/usr/bin/env node
/**
 * B-106 and B-156 screens in Carthage (dark, 1440x900). Changes no data.
 * Usage: node .local-docs/agents/data/screens-b106-b156.cjs
 * Writes PNGs to .local-docs/agents/plans/B-156-screens/ (top bar) and plans/B-106-screens/ (notification settings).
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");

const BASE = "http://localhost:3000";
const PASSWORD = process.env.FUSION_LOCAL_PASSWORD;
const PLANS = path.join(__dirname, "..", "plans");

async function signIn(page, email) {
  await page.goto(`${BASE}/auth/signin`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  const submit = page.locator('button[type="submit"]');
  await submit.waitFor({ state: "visible", timeout: 120_000 });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.fill("#email", email);
    await page.fill("#password", PASSWORD);
    await page.waitForTimeout(500);
    if ((await page.inputValue("#email")) === email) break;
  }
  await submit.click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 120_000 });
}

async function shot(page, item, name) {
  const dir = path.join(PLANS, `${item}-screens`);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
  console.log(`  ${item}-screens/${name}.png`);
}

async function open(page, url, text) {
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await page.getByText(text).first().waitFor({ state: "visible", timeout: 240_000 });
  await page.waitForTimeout(1500);
}

(async () => {
  const browser = await chromium.launch();
  try {
    for (const [who, steps] of [
      ["amira.khelifi", async (page) => {
        await open(page, "/", "Good");
        await page.getByRole("button", { name: "Change language" }).click();
        await page.getByText("العربية").waitFor({ state: "visible" });
        await page.waitForTimeout(400);
        await shot(page, "B-156", "01-home-language-menu");
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: "Change theme" }).click();
        await page.waitForTimeout(400);
        await shot(page, "B-156", "02-home-theme-menu");
        await page.keyboard.press("Escape");
        await open(page, "/performance/settings/notifications", "Deadline reminders");
        await shot(page, "B-106", "01-performance-company-modes");
        await open(page, "/core/settings/notifications", "Team and job changes");
        await shot(page, "B-106", "02-core-company-modes");
      }],
      ["leila.baccouche", async (page) => {
        await open(page, "/settings/notifications", "Deadline reminders");
        await shot(page, "B-106", "03-personal-required-lock");
      }],
    ]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
      await context.addInitScript(() => { try { window.localStorage.setItem("theme", "dark"); } catch {} });
      const page = await context.newPage();
      await signIn(page, `${who}@example.test`);
      await steps(page);
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
