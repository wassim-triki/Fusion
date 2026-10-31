#!/usr/bin/env node
/**
 * B-183 screens: Organization in time (People, Structure and List views on one slider, Planned) and a unit page.
 * Dark at 1440×900, through the shell, in Carthage Digital Group. Changes no data.
 *
 * Usage: node .local-docs/agents/data/screens-b183-organization.cjs
 * Writes PNGs to .local-docs/agents/plans/B-183-screens/<name>.png.
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const { call, login } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const BASE = "http://localhost:3000";
const PASSWORD = process.env.FUSION_LOCAL_PASSWORD;
const OUT = path.join(__dirname, "..", "plans", "B-183-screens");
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
  // B183_ROUND names a review round's retakes (r1-01-….png) beside the first set.
  const file = `${process.env.B183_ROUND ? `${process.env.B183_ROUND}-` : ""}${name}.png`;
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
  const only = process.argv.slice(2);
  const want = (name) => only.length === 0 || only.some((prefix) => name.startsWith(prefix));
  try {
    const hr = await session(browser, "amira.khelifi@example.test");
    const nextJan = `${new Date().getUTCFullYear() + 1}-01-01`;
    if (want("01")) {
      await open(hr.page, "/core/organization", (p) => p.getByRole("slider", { name: "Date" }));
      await hr.page.getByText("Sami Ben Youssef").first().waitFor({ timeout: 240_000 });
      await shot(hr.page, "01-structure-today");
    }
    if (want("02")) {
      await open(hr.page, `/core/organization?asOf=${nextJan}`, (p) => p.getByRole("slider", { name: "Date" }));
      await hr.page.getByText("Sami Ben Youssef").first().waitFor({ timeout: 240_000 });
      await shot(hr.page, "02-structure-planned-move");
    }
    if (want("03")) {
      await open(hr.page, "/core/organization?asOf=2021-01-01", (p) => p.getByRole("slider", { name: "Date" }));
      await hr.page.getByText("2021").first().waitFor({ timeout: 240_000 });
      await hr.page.waitForTimeout(3000);
      await shot(hr.page, "03-structure-2021");
    }
    if (want("04")) {
      await open(hr.page, "/core/organization?view=list", (p) => p.getByRole("table").first());
      await hr.page.getByText("Sami Ben Youssef").first().waitFor({ timeout: 240_000 });
      await shot(hr.page, "04-list-today");
    }
    if (want("05")) {
      await open(hr.page, "/core/organization?view=people", (p) => p.getByRole("slider", { name: "Date" }));
      await hr.page.waitForTimeout(3000);
      await shot(hr.page, "05-people-today");
    }
    if (want("06")) {
      await open(hr.page, "/core/organization", (p) => p.getByRole("heading", { name: "Planned" }));
      await hr.page.getByText("Skander Mejri").first().waitFor({ timeout: 240_000 });
      await hr.page.getByRole("heading", { name: "Planned" }).evaluate((node) => node.closest("section").scrollIntoView({ block: "end" }));
      await shot(hr.page, "06-planned-list");
    }
    if (want("07")) {
      const token = await login("amira.khelifi@example.test");
      const found = await call("GET", `/api/corehr/organization/search?query=Consulting&asOf=${new Date().toISOString().slice(0, 10)}`, null, token);
      const unitId = found.json?.data?.find((unit) => unit.name === "Consulting")?.id;
      if (unitId) {
        await open(hr.page, `/core/organization/units/${unitId}`, (p) => p.getByRole("heading", { level: 1, name: "Consulting" }));
        await hr.page.getByText("Ines Chaabane").first().waitFor({ timeout: 240_000 });
        await shot(hr.page, "07-unit-page");
      }
    }
    if (want("09")) {
      await open(hr.page, "/core/settings/jobs", (p) => p.getByRole("heading", { level: 1, name: "Jobs" }));
      await hr.page.getByRole("cell").first().waitFor({ timeout: 240_000 });
      await hr.page.waitForTimeout(1500);
      await shot(hr.page, "09-settings-jobs");
    }
    await hr.context.close();
    if (want("08")) {
      const employee = await session(browser, "leila.baccouche@example.test");
      await open(employee.page, "/core/organization", (p) => p.getByRole("button", { name: /zoom|fit/i }).first());
      await shot(employee.page, "08-people-employee");
      await employee.context.close();
    }
  } finally {
    await browser.close();
  }
})();
