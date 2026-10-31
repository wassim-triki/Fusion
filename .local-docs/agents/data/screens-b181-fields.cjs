#!/usr/bin/env node
/**
 * B-181 screens: the company's own fields. Dark at 1440×900, through the shell, in Carthage Digital Group.
 *
 * Amira Khelifi (administrator, HR) on Settings › Fields, previewing Aicha Bouazizi's page, then with Certifications
 * added from the gallery before saving (not saved). Aicha on her own Overview with Skills and Languages as chips.
 * Run journey-b181-fields.cjs first (it switches the two fields on and fills Aicha's). Changes no data.
 * Also frames the accepted drawing ("Your own fields") as ref-fields.png for the side-by-side review.
 *
 * Usage: node .local-docs/agents/data/screens-b181-fields.cjs
 * Writes PNGs to .local-docs/agents/plans/B-181-screens/<name>.png.
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");

const BASE = "http://localhost:3000";
const PASSWORD = process.env.FUSION_LOCAL_PASSWORD;
const OUT = path.join(__dirname, "..", "plans", "B-181-screens");
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
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ${name}.png`);
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
    const hr = await session(browser, "amira.khelifi@example.test");
    await hr.page.goto(`${BASE}/core/settings/employee-fields`, { waitUntil: "domcontentloaded", timeout: 240_000 });
    await hr.page.getByRole("heading", { name: "Ready-made" }).waitFor({ timeout: 240_000 });
    const picker = hr.page.locator("aside").getByRole("combobox");
    await picker.click();
    await hr.page.getByRole("option", { name: /Aicha/ }).click();
    await hr.page.waitForTimeout(2500);
    await shot(hr.page, "01-fields");
    await hr.page.getByRole("button", { name: "Add", exact: true }).first().click();
    await shot(hr.page, "02-fields-certifications-added");
    await hr.context.close();

    const own = await session(browser, "aicha.bouazizi@example.test");
    await own.page.goto(`${BASE}/core/profile`, { waitUntil: "domcontentloaded", timeout: 240_000 });
    await own.page.getByText("Languages spoken").first().waitFor({ timeout: 240_000 });
    await shot(own.page, "03-overview-chips");
    await own.page.getByRole("button", { name: "Edit" }).last().click();
    await shot(own.page, "04-overview-chips-editing");
    await own.context.close();

    const ref = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: "dark" });
    const drawing = await ref.newPage();
    await drawing.goto("file:///" + path.join(__dirname, "..", "plans", "B-164-explorer.html").replace(/\\/g, "/"), { waitUntil: "networkidle" });
    await drawing.evaluate(() => {
      try { view.pins = "off"; applyView(); } catch {}
      const fx = document.querySelector("#stage-fields .fx");
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;inset:0;z-index:99999;width:1440px;height:900px;overflow:hidden;background:#000";
      const clone = fx.cloneNode(true);
      clone.style.transform = "none";
      clone.querySelectorAll(".pin").forEach((pin) => pin.remove());
      host.appendChild(clone);
      document.body.appendChild(host);
    });
    await drawing.waitForTimeout(400);
    await drawing.screenshot({ path: path.join(OUT, "ref-fields.png"), clip: { x: 0, y: 0, width: 1440, height: 900 } });
    console.log("  ref-fields.png");
    await ref.close();
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
