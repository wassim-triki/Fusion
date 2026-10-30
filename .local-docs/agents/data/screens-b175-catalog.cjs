#!/usr/bin/env node
/**
 * B-175 screens: the company's jobs, places and lists, and the job picker in today's forms. Dark at 1440×900, through
 * the shell, as Amira Khelifi (tenant administrator) in Carthage Digital Group. Changes no data (dialogs are closed).
 *
 * Usage: node .local-docs/agents/data/screens-b175-catalog.cjs
 * Writes PNGs to .local-docs/agents/plans/B-175-screens/<name>.png.
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");

const BASE = "http://localhost:3000";
const PASSWORD = process.env.FUSION_LOCAL_PASSWORD;
const OUT = path.join(__dirname, "..", "plans", "B-175-screens");
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
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ${name}.png`);
}

async function open(page, route, ready) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await ready.waitFor({ state: "visible", timeout: 240_000 });
  await page.waitForTimeout(1200);
}

(async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
    await context.addInitScript(() => { try { window.localStorage.setItem("theme", "dark"); } catch {} });
    const page = await context.newPage();
    await signIn(page, "amira.khelifi@example.test");

    await open(page, "/core/organization/jobs", page.getByRole("cell", { name: /Software Engineer/ }).first());
    await shot(page, "01-jobs-by-family");

    await page.getByRole("row", { name: /Senior Software Engineer/ }).first().click();
    await page.getByRole("dialog").waitFor({ state: "visible" });
    await shot(page, "02-edit-job");
    await page.keyboard.press("Escape");

    await page.getByRole("row", { name: /Product Analyst/ }).first().getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Merge into another job" }).click();
    await page.getByRole("dialog").waitFor({ state: "visible" });
    await shot(page, "03-merge-job");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Filter" }).first().click().catch(() => {});
    await page.waitForTimeout(400);
    await page.keyboard.press("Escape");
    await page.getByPlaceholder("Find a job").fill("engineer");
    await shot(page, "04-jobs-search");

    await open(page, "/core/organization/places", page.getByRole("cell", { name: /Tunis/ }).first());
    await shot(page, "05-places");

    await open(page, "/core/settings/lists", page.getByRole("heading", { name: "Employment types" }));
    await shot(page, "06-lists");
    await page.mouse.wheel(0, 900);
    await shot(page, "07-lists-below");

    await open(page, "/core/people/hire", page.getByRole("heading", { level: 1 }));
    const jobPicker = page.getByRole("combobox", { name: /Pick a job/ }).or(page.getByText("Pick a job")).first();
    await jobPicker.scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 300);
    await jobPicker.click();
    await page.keyboard.type("analyst");
    await shot(page, "08-hire-job-picker");
    await page.keyboard.press("Control+A");
    await page.keyboard.type("Data Steward");
    await shot(page, "09-hire-add-job");
    await page.keyboard.press("Escape");

    await open(page, "/core/organization", page.getByRole("navigation", { name: "Organization lenses" }));
    await shot(page, "10-organization-lenses");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
