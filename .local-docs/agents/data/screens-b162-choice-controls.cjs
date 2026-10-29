#!/usr/bin/env node
/**
 * B-162 screens in Carthage (dark, 1440x900, Amira): the shared choice controls in place. Changes no data.
 * Usage: node .local-docs/agents/data/screens-b162-choice-controls.cjs
 * Writes PNGs to .local-docs/agents/plans/B-162-screens/<name>.png.
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");

const BASE = "http://localhost:3000";
const PASSWORD = process.env.FUSION_LOCAL_PASSWORD;
const OUT = path.join(__dirname, "..", "plans", "B-162-screens");
fs.mkdirSync(OUT, { recursive: true });

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

async function open(page, url, text) {
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await page.getByText(text).first().waitFor({ state: "visible", timeout: 240_000 });
  await page.waitForTimeout(1500);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ${name}.png`);
}

(async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
    await context.addInitScript(() => { try { window.localStorage.setItem("theme", "dark"); } catch {} });
    const page = await context.newPage();
    await signIn(page, "amira.khelifi@example.test");

    await open(page, "/performance/settings/notifications", "Deadline reminders");
    await shot(page, "01-notification-matrix");

    await open(page, "/settings", "Appearance");
    await shot(page, "02-preferences-cards-and-language");

    await open(page, "/performance/goals?view=map", "Map");
    await shot(page, "03-direction-view-switch");

    await open(page, "/core/org-chart", "Colour by");
    await shot(page, "04-org-chart-view-switch");

    await open(page, "/", "Good");
    await page.getByRole("button", { name: /Notifications/ }).first().click();
    await page.getByRole("radio", { name: /Core HR/ }).first().waitFor({ state: "visible" });
    await page.waitForTimeout(500);
    await shot(page, "05-bell-filter-chips");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
