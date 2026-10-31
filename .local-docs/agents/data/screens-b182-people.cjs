#!/usr/bin/env node
/**
 * B-182 screens: People, the directory, the invite sheet, Settings › Sign-in and the Add a person form (B-199).
 * Dark at 1440×900, through the shell, in Carthage Digital Group. Changes no data.
 *
 * Usage: node .local-docs/agents/data/screens-b182-people.cjs
 * Writes PNGs to .local-docs/agents/plans/B-182-screens/<name>.png.
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");

const BASE = "http://localhost:3000";
const PASSWORD = process.env.FUSION_LOCAL_PASSWORD;
const OUT = path.join(__dirname, "..", "plans", "B-182-screens");
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

async function open(page, url, waitFor) {
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await waitFor(page).waitFor({ timeout: 240_000 });
}

(async () => {
  const browser = await chromium.launch();
  try {
    const hr = await session(browser, "amira.khelifi@example.test");
    await open(hr.page, "/core/people", (p) => p.getByRole("columnheader", { name: "Sign-in" }));
    await shot(hr.page, "01-people-hr");
    await open(hr.page, "/core/people?view=not-signed-in", (p) => p.getByRole("columnheader", { name: "Sign-in" }));
    await shot(hr.page, "02-people-not-signed-in");
    await open(hr.page, "/core/people?view=not-signed-in&invite=1", (p) => p.getByText("Everyone who isn't signed in"));
    await hr.page.locator("iframe").first().waitFor({ timeout: 120_000 });
    await hr.page.waitForTimeout(2500);
    await shot(hr.page, "03-invite-sheet");
    await hr.page.getByRole("radio", { name: "Later" }).click();
    await shot(hr.page, "04-invite-later");
    await hr.page.getByRole("radio", { name: "Choose people" }).click();
    await hr.page.getByRole("checkbox").first().waitFor({ timeout: 120_000 });
    await hr.page.getByRole("checkbox").nth(1).click();
    await hr.page.getByRole("checkbox").nth(2).click();
    await shot(hr.page, "04b-invite-chosen");
    await hr.page.keyboard.press("Escape");
    await open(hr.page, "/core/people?layout=cards", (p) => p.getByRole("navigation", { name: "Jump to a letter" }));
    await shot(hr.page, "05-people-cards-hr");
    await open(hr.page, "/core/settings/sign-in", (p) => p.getByText("Remind after"));
    await shot(hr.page, "06-settings-sign-in");
    await open(hr.page, "/core/people/add", (p) => p.getByRole("heading", { name: "New person" }));
    await shot(hr.page, "07-add-person-empty");
    await hr.page.fill("#firstName", "Ons");
    await hr.page.fill("#lastName", "Khemiri");
    await hr.page.fill("#workEmail", "ons.khemiri@example.test");
    await shot(hr.page, "08-add-person-typing");
    await hr.context.close();

    const aicha = await session(browser, "aicha.bouazizi@example.test");
    await open(aicha.page, "/core/people", (p) => p.getByRole("heading", { name: "Your team" }));
    await shot(aicha.page, "09-directory-employee");
    await aicha.context.close();
  } finally {
    await browser.close();
  }
})();
