#!/usr/bin/env node
/**
 * B-179 review round (B-224–B-227) screens: the second pass on the change panel, Home and sections. Dark at 1440×900, through the shell, in Carthage Digital Group.
 *
 * Mariam Gharbi (manager) describes Aicha Bouazizi's promotion in a sentence, drafts it and sends it for approval;
 * Aicha's page shows it waiting. Amira Khelifi (administrator, HR) sees it in Needs you on Home with Approve and
 * Decline (and the decline popover), on Changes and approvals, opened, and approves it from Home. Settings › Changes
 * and approvals; Aicha's Personal tab with a new address waiting for HR; Mariam's answered list.
 *
 * Temporarily turns approval on for job changes and home addresses; leaves Carthage as it found it (the promotion
 * cancelled, Aicha's address request withdrawn, the settings restored).
 *
 * Also frames the accepted drawing (explorer checkpoint 3: describe a change, Home every day, Aicha's Personal tab)
 * at the same size, as ref-*.png, for the side-by-side review.
 *
 * Usage: node .local-docs/agents/data/screens-b179-profile.cjs (the person page part of round 2: r2-09 to r2-11)
 * Writes PNGs to .local-docs/agents/plans/B-179-screens/<name>.png.
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const { call, login } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const BASE = "http://localhost:3000";
const PASSWORD = process.env.FUSION_LOCAL_PASSWORD;
const OUT = path.join(__dirname, "..", "plans", "B-179-screens");
const R = "r2-";
fs.mkdirSync(OUT, { recursive: true });
const data = (r) => r.json?.data;

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
  // A click before the form hydrates does nothing; try again rather than wait it out.
  for (let attempt = 0; ; attempt += 1) {
    await submit.click();
    try {
      await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 60_000, waitUntil: "commit" });
      return;
    } catch (error) {
      await page.screenshot({ path: path.join(OUT, "..", `signin-debug-${attempt}.png`) });
      if (attempt >= 2) throw error;
      await page.fill("#email", email);
      await page.fill("#password", PASSWORD);
    }
  }
}

async function shot(page, name) {
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUT, `${R}${name}.png`) });
  console.log(`  ${R}${name}.png`);
}

async function open(page, route, ready) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await ready.waitFor({ state: "visible", timeout: 240_000 });
  await page.waitForTimeout(2000);
}

async function session(browser, email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await context.addInitScript(() => { try { window.localStorage.setItem("theme", "dark"); } catch {} });
  const page = await context.newPage();
  await signIn(page, email);
  return { context, page };
}

(async () => {
  const browser = await chromium.launch();
  try {
    // The person page's tabs, sections stacked with their titles inside.
    const self = await session(browser, "aicha.bouazizi@example.test");
    await open(self.page, "/core/profile?tab=personal", self.page.getByText("Legal name"));
    await shot(self.page, "09-personal-sections");
    await self.page.mouse.wheel(0, 600);
    await shot(self.page, "10-personal-sections-below");
    await open(self.page, "/core/profile?tab=job", self.page.getByText("Employment").first());
    await shot(self.page, "11-job-sections");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
