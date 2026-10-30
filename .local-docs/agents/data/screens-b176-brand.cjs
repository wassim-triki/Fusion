#!/usr/bin/env node
/**
 * B-176 screens: the brand studio and where the brand shows. Dark at 1440×900, through the shell, Carthage Digital
 * Group. Run after `journey-b176-brand.cjs --keep` (blue, a logo, Arabic default). Captures sign-in signed out in the
 * company's language, then sets the default language back to English (so Amira's session is English), and captures
 * Home, the studio and its three previews (the Arabic draft unsaved), Details and Core HR in the brand.
 *
 * Usage: node .local-docs/agents/data/screens-b176-brand.cjs
 * Writes PNGs to .local-docs/agents/plans/B-176-screens/<name>.png.
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const { call, login } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const BASE = "http://localhost:3000";
const PASSWORD = process.env.FUSION_LOCAL_PASSWORD;
const OUT = path.join(__dirname, "..", "plans", "B-176-screens");
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
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ${name}.png`);
}

async function open(page, route, ready) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await ready.waitFor({ state: "visible", timeout: 240_000 });
  await page.waitForTimeout(1500);
}

async function newContext(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await context.addInitScript(() => { try { window.localStorage.setItem("theme", "dark"); } catch {} });
  return context;
}

(async () => {
  const amiraToken = await login("amira.khelifi@example.test");
  const summary = (await call("GET", "/api/identity/tenant-context/tenant-summary", null, amiraToken)).json.data;
  const setLanguage = (language) => call("PUT", "/api/identity/brand",
    { name: summary.name, color: summary.brandColor, language, logo: "keep", logoPng: null }, amiraToken);
  await setLanguage("ar");
  const browser = await chromium.launch();
  try {
    // Signed out, a link naming the company, a browser with no language yet: the company's brand, in Arabic.
    const outside = await newContext(browser);
    const signedOut = await outside.newPage();
    await open(signedOut, `/auth/signin?company=${summary.slug}`, signedOut.getByRole("heading", { level: 2, name: summary.name }));
    await signedOut.waitForTimeout(3000);
    await shot(signedOut, "01-sign-in-company-language-ar");
    await outside.close();

    await setLanguage("en");

    const context = await newContext(browser);
    const page = await context.newPage();
    await signIn(page, "amira.khelifi@example.test");
    await open(page, "/", page.getByRole("heading", { level: 1 }));
    await shot(page, "02-home-in-the-brand");

    await open(page, "/core/settings/brand", page.getByLabel("Company name"));
    await shot(page, "03-studio-home-preview");

    await page.getByRole("button", { name: "#0f7c78" }).click().catch(() => page.getByRole("button", { name: "#17804a" }).click());
    await page.getByRole("radio", { name: "العربية" }).click();
    await shot(page, "04-studio-draft-teal-arabic-home");

    await page.getByRole("radio", { name: "Sign-in" }).click();
    await shot(page, "05-studio-sign-in-preview-ar");

    await page.getByRole("radio", { name: "Invitation email" }).click();
    await page.locator("iframe").waitFor({ state: "visible", timeout: 60_000 });
    await shot(page, "06-studio-email-preview-ar");

    await page.locator("input[type=color]").evaluate((input) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, "#ffe066");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.getByRole("radio", { name: "Home" }).click();
    await shot(page, "07-studio-any-colour-light-yellow");

    await page.getByRole("button", { name: "Discard" }).click();
    await open(page, "/core/settings/details", page.getByRole("heading", { level: 1 }));
    await shot(page, "08-details");
    await open(page, "/core/people", page.getByRole("heading", { level: 1 }));
    await shot(page, "09-core-people-in-the-brand");
    await context.close();

    // Signed out again on the same browser as Amira: it remembers the company.
    const again = await newContext(browser);
    const back = await again.newPage();
    await back.goto(`${BASE}/auth/signin`, { waitUntil: "domcontentloaded" });
    await back.evaluate((slug) => window.localStorage.setItem("fusion:last-company", slug), summary.slug);
    await open(back, "/auth/signin", back.getByRole("heading", { level: 2, name: summary.name }));
    await shot(back, "10-sign-in-remembered-company-en");
    await again.close();
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
