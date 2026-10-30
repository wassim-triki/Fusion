#!/usr/bin/env node
/**
 * B-166 reference screens: the surfaces the design direction names as references, live in Carthage · Mid-year
 * (dark, 1440x900, viewport shots), into .local-docs/agents/plans/B-166-screens/reference/.
 * Usage: node .local-docs/agents/data/screens-b166-reference.cjs   (B166_FORCE=1 retakes existing shots)
 * Changes no data.
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const helper = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");

const BASE = "http://localhost:3000";
const PASSWORD = process.env.FUSION_LOCAL_PASSWORD;
const OUT = path.join(__dirname, "..", "plans", "B-166-screens", "reference");
const DOMAIN = "midyear-5.example.test";
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
  try {
    await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 120_000, waitUntil: "commit" });
  } catch {
    if ((await page.inputValue("#password").catch(() => "")) === "") await page.fill("#password", PASSWORD);
    await submit.click();
    await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 180_000, waitUntil: "commit" });
  }
}

async function settled(page, settle = 2000) {
  await page.waitForTimeout(1500);
  await page.waitForFunction(
    () => !document.querySelector('[aria-busy="true"], .animate-pulse, [data-slot="skeleton"]'),
    null,
    { timeout: 30_000 },
  ).catch(() => {});
  await page.waitForTimeout(settle);
}

const exists = (key) => fs.existsSync(path.join(OUT, `${key}.png`)) && process.env.B166_FORCE !== "1";

async function shot(page, key) {
  await page.screenshot({ path: path.join(OUT, `${key}.png`) });
  console.log(`  ${key}  ${new URL(page.url()).pathname}`);
}

async function visit(page, key, url, settle) {
  if (exists(key)) return;
  try {
    await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
    await settled(page, settle);
    await shot(page, key);
  } catch (error) {
    console.log(`  ${key}  FAILED ${String(error).slice(0, 160)}`);
  }
}

/** Opens a page, clicks the first link matching `selector` and captures what it opens. */
async function open(page, key, url, selector, settle) {
  if (exists(key)) return;
  try {
    await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
    await settled(page, 1000);
    await page.locator(selector).first().click({ timeout: 30_000 });
    await settled(page, settle);
    await shot(page, key);
  } catch (error) {
    console.log(`  ${key}  FAILED ${String(error).slice(0, 160)}`);
  }
}

async function as(browser, email, run) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await context.addInitScript(() => { try { window.localStorage.setItem("theme", "dark"); } catch {} });
  const page = await context.newPage();
  await signIn(page, email);
  try { await run(page); } finally { await context.close(); }
}

(async () => {
  const amira = `amira.khelifi@${DOMAIN}`;
  const token = await helper.login(amira);
  const found = await helper.call("GET", "/api/corehr/employees/people?pageSize=200", undefined, token);
  const aicha = found.json?.data?.items?.find((person) => person.firstName === "Aicha");
  const browser = await chromium.launch();
  try {
    await as(browser, amira, async (page) => {
      await visit(page, "home-amira", "/");
      await visit(page, "org-chart", "/core/org-chart", 3000);
      await visit(page, "org-chart-company", "/core/org-chart?scope=company", 3000);
      await visit(page, "organization-chart", "/core/organization", 3000);
      if (aicha) {
        await visit(page, "person-aicha", `/core/people/${aicha.employeeKey}`);
        await visit(page, "person-aicha-change", `/core/people/${aicha.employeeKey}?change=job`);
      }
      await visit(page, "perf-my-plan", "/performance/plan");
      await open(page, "perf-objective-drawer", "/performance/plan", 'a[href*="/objectives/"]', 2000);
      await visit(page, "perf-one-on-ones", "/performance/one-on-ones");
      await open(page, "perf-one-on-one-series", "/performance/one-on-ones", 'a[href*="/one-on-ones/"]', 2000);
      await visit(page, "perf-feedback", "/performance/feedback");
      await visit(page, "perf-alignment-map", "/performance/goals", 3000);
      await visit(page, "perf-team", "/performance/team");
      await visit(page, "settings-perf", "/performance/settings");
      await visit(page, "settings-roles", "/core/settings/roles");
      await open(page, "notifications-panel", "/", 'button[aria-label^="Notifications"]', 1500);
    });
    await as(browser, `aicha.bouazizi@${DOMAIN}`, async (page) => {
      await visit(page, "home-aicha", "/");
      await visit(page, "profile-aicha-self", "/core/profile");
    });
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
