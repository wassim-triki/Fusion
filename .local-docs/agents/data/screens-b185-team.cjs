#!/usr/bin/env node
/**
 * B-185 screens: the Team page as Mariam Gharbi (a manager), one per tab: Overview, Performance, Org chart.
 * Dark at 1440×900, through the shell, in Carthage Digital Group. Changes no data.
 *
 * Usage: node .local-docs/agents/data/screens-b185-team.cjs
 * Writes PNGs to .local-docs/agents/plans/B-185-screens/<name>.png.
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const { call: _call, login: _login } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const BASE = "http://localhost:3000";
const PASSWORD = process.env.FUSION_LOCAL_PASSWORD;
const OUT = path.join(__dirname, "..", "plans", "B-185-screens");
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

async function shot(page, name) {
  await page.waitForTimeout(1500);
  // B185_ROUND names a review round's retakes (r1-01-….png) beside the first set.
  const file = `${process.env.B185_ROUND ? `${process.env.B185_ROUND}-` : ""}${name}.png`;
  await page.screenshot({ path: path.join(OUT, file) });
  console.log(`  ${file}`);
}

async function session(browser, email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await context.addInitScript(() => { try { window.localStorage.setItem("theme", "dark"); } catch {} });
  const page = await context.newPage();
  await signIn(page, email);
  return { context, page };
}

async function open(page, url, waitFor) {
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await waitFor(page).waitFor({ timeout: 240_000 });
}

(async () => {
  const browser = await chromium.launch();
  try {
    const mariam = await session(browser, "mariam.gharbi@example.test");
    if (process.argv[2] === "chart") { await open(mariam.page, "/core/team/org-chart", (p) => p.locator("#team-title")); await mariam.page.waitForTimeout(6000); await mariam.page.mouse.wheel(0, 500); await shot(mariam.page, "04-team-org-chart"); return; }
    await open(mariam.page, "/core/team", (p) => p.getByRole("heading", { name: "Coming up" }));
    await shot(mariam.page, "01-team-overview");
    await mariam.page.mouse.wheel(0, 700);
    await shot(mariam.page, "02-team-overview-below");
    await open(mariam.page, "/performance/team", (p) => p.locator("#team-title"));
    await mariam.page.waitForTimeout(4000);
    await shot(mariam.page, "03-team-performance");
    await open(mariam.page, "/core/team/org-chart", (p) => p.locator(".react-flow, [data-org-chart], svg").first());
    await mariam.page.waitForTimeout(3000);
    await mariam.page.mouse.wheel(0, 500);
    await shot(mariam.page, "04-team-org-chart");
    await mariam.context.close();
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
