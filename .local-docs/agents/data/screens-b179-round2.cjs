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
 * Usage: node .local-docs/agents/data/screens-b179-round2.cjs (writes r2-*.png beside round 1)
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
  const amira = await login("amira.khelifi@example.test");
  const before = data(await call("GET", "/api/corehr/changes/approvals", null, amira));
  const restore = before.types.filter((type) => type.required).map((type) => type.type);
  await call("PUT", "/api/corehr/changes/approvals", { required: ["job", "homeAddress"] }, amira);
  const aicha = data(await call("GET", "/api/corehr/employees/people?q=Aicha", null, amira)).items.find((p) => p.displayName.startsWith("Aicha"));
  const now = new Date();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1)).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });

  const browser = await chromium.launch();
  try {
    // B-224: Mariam types; Fusion drafts when she pauses. No Draft it button; sparkles on what AI filled.
    const mariam = await session(browser, "mariam.gharbi@example.test");
    await open(mariam.page, `/core/people/${aicha.employeeKey}`, mariam.page.getByRole("button", { name: /Propose a change/ }));
    await mariam.page.getByRole("button", { name: /Propose a change/ }).click();
    await mariam.page.getByLabel("Describe it").pressSequentially(`Promote Aicha to Senior Consultant from 1 ${month}`, { delay: 25 });
    await mariam.page.getByText("Senior Consultant", { exact: true }).waitFor({ timeout: 60_000 });
    await mariam.page.getByLabel(/Note for/).fill("She owns the regression suite and runs the QA guild.");
    await mariam.page.getByLabel(/Note for/).blur();
    await shot(mariam.page, "01-drafted-while-typing");
    await mariam.page.getByRole("dialog").locator("button[data-empty]").first().click();
    await mariam.page.getByRole("grid").first().waitFor({ timeout: 15_000 });
    await shot(mariam.page, "02-from-ds-calendar");
    await mariam.page.keyboard.press("Escape");
    await mariam.page.getByRole("button", { name: "Send for approval" }).click();
    await mariam.page.waitForTimeout(3000);

    // B-226: Amira's Home.
    const hr = await session(browser, "amira.khelifi@example.test");
    await open(hr.page, "/", hr.page.getByRole("button", { name: "Approve" }).first());
    await hr.page.waitForTimeout(3000);
    await shot(hr.page, "03-home-amira");
    await hr.page.getByRole("button", { name: "Decline" }).first().click();
    await hr.page.getByLabel("Why not?").fill("Let's wait for the year-end review.");
    await shot(hr.page, "04-decline-why-carved");
    await hr.page.keyboard.press("Escape");

    // Mariam's Home: an approved year and praise.
    await open(mariam.page, "/", mariam.page.getByRole("heading", { name: "Your year" }));
    await mariam.page.waitForTimeout(3000);
    await shot(mariam.page, "05-home-mariam");

    // B-225: sections with their titles inside.
    await open(hr.page, "/core/settings/approvals", hr.page.getByText("Who approves"));
    await shot(hr.page, "06-settings-sections");
    await open(mariam.page, "/performance/one-on-ones", mariam.page.locator("section[aria-labelledby^='rhythm-']").first());
    await shot(mariam.page, "07-one-on-ones-sections");

    // B-227: the DS date picker where a native one was (a birthday, with month and year menus).
    const self = await session(browser, "aicha.bouazizi@example.test");
    await open(self.page, "/core/profile?tab=personal", self.page.getByRole("button", { name: /^Edit/ }).first());
    await self.page.getByRole("button", { name: /^Edit/ }).first().click();
    const birthday = self.page.getByLabel("Date of birth");
    await birthday.waitFor({ timeout: 15_000 });
    await birthday.click();
    await self.page.getByRole("grid").first().waitFor({ timeout: 15_000 });
    await shot(self.page, "08-birthday-ds-picker");
  } finally {
    await browser.close();
    const stillPending = data(await call("GET", "/api/corehr/changes/requests", null, amira)) ?? [];
    for (const r of stillPending.filter((r) => r.person.employeeKey === aicha.employeeKey && r.kind === "JobChange"))
      await call("POST", `/api/corehr/changes/requests/${r.id}/decline`, { reason: "Screens clean-up" }, amira);
    await call("PUT", "/api/corehr/changes/approvals", { required: restore }, amira);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
