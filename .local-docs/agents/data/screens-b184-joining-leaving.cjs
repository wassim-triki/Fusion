#!/usr/bin/env node
/**
 * B-184 screens: Settings › Joining and leaving, a joiner's checklist on their page (HR), Home as the joiner's
 * manager (Needs you with the checklist, Coming up with a birthday and an anniversary), Personal's birthday choice.
 * Dark at 1440×900, through the shell, in Carthage Digital Group. Changes no data.
 *
 * Usage: node .local-docs/agents/data/screens-b184-joining-leaving.cjs
 * Writes PNGs to .local-docs/agents/plans/B-184-screens/<name>.png.
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const { call, login } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const BASE = "http://localhost:3000";
const PASSWORD = process.env.FUSION_LOCAL_PASSWORD;
const OUT = path.join(__dirname, "..", "plans", "B-184-screens");
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
  // B184_ROUND names a review round's retakes (r1-01-….png) beside the first set.
  const file = `${process.env.B184_ROUND ? `${process.env.B184_ROUND}-` : ""}${name}.png`;
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
    const amira = await login("amira.khelifi@example.test");
    const upcoming = (await call("GET", "/api/corehr/employees/people/changes/upcoming", null, amira)).json.data;
    const yasmine = upcoming.find((change) => change.person.displayName === "Yasmine Trabelsi").person;

    const hr = await session(browser, "amira.khelifi@example.test");
    await open(hr.page, "/core/settings/checklists", (p) => p.locator('input[value="Order a laptop and a badge"]'));
    await shot(hr.page, "01-settings-joining-and-leaving");
    if (process.argv[2] === "settings") return;
    await open(hr.page, `/core/people/${yasmine.employeeKey}`, (p) => p.locator("#checklist"));
    await hr.page.locator("#checklist").scrollIntoViewIfNeeded();
    await shot(hr.page, "02-joiner-checklist-hr");
    await hr.context.close();

    const manager = await session(browser, "mariam.gharbi@example.test");
    await open(manager.page, "/", (p) => p.getByText("Welcome Yasmine Trabelsi").first());
    await shot(manager.page, "03-home-manager");
    await manager.context.close();

    const aicha = await session(browser, "aicha.bouazizi@example.test");
    await open(aicha.page, "/core/profile?tab=personal", (p) => p.locator("#share-birthday"));
    await aicha.page.locator("#share-birthday").scrollIntoViewIfNeeded();
    await shot(aicha.page, "04-personal-birthday");
    await aicha.context.close();
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
