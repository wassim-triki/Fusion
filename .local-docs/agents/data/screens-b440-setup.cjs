#!/usr/bin/env node
/**
 * B-440 slice 12 (setting up a year): Amira Khelifi (the administrator) on Set up FY…, live through the shell, dark,
 * 1440x900, on the `nextcycle` preset (this year ended with results out, next year waiting as a draft): the page as it
 * opens, and the Year page with its next step. Writes .local-docs/agents/plans/B-440-screens/{setup,year}.png. Changes
 * no data.
 * Usage: node .local-docs/agents/data/screens-b440-setup.cjs [domain]   (default: the nextcycle preset's domain)
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const helper = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");
const presets = require("./demo-presets.local.json");

const BASE = "http://localhost:3000";
const PASSWORD = process.env.FUSION_LOCAL_PASSWORD;
const DOMAIN = process.argv[2] ?? (presets.presets?.nextcycle ?? presets.nextcycle).domain;
const OUT = path.join(__dirname, "..", "plans", "B-440-screens");
fs.mkdirSync(OUT, { recursive: true });

async function settled(page, settle = 2000) {
  await page.waitForTimeout(1500);
  await page.waitForFunction(
    () => !document.querySelector('[aria-busy="true"], .animate-pulse, [data-slot="skeleton"]'),
    null, { timeout: 60_000 },
  ).catch(() => {});
  await page.waitForTimeout(settle);
}

async function shoot(browser, who) {
  const email = `${who}@${DOMAIN}`;
  const response = await helper.call("POST", "/api/identity/auth/login", { email, password: PASSWORD });
  if (response.status !== 200) throw new Error(`Sign-in failed for ${email}: ${response.status}`);
  const d = response.json.data;
  const auth = { accessToken: d.accessToken, refreshToken: d.refreshToken, accessTokenExpiration: d.accessTokenExpiration,
    user: { userId: d.userId, tenantId: d.tenantId ?? null, tenantMembershipId: d.tenantMembershipId ?? null,
      moduleEntitlements: d.moduleEntitlements ?? [], email: d.email, fullName: d.fullName, roles: d.roles,
      employeeId: d.employeeId ?? null, accessProfiles: d.accessProfiles ?? [], effectivePermissions: d.effectivePermissions ?? [],
      language: d.language, notificationPopups: d.notificationPopups, notificationSound: d.notificationSound } };
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await context.addCookies([{ name: "ey_hr_authenticated", value: "true", url: BASE }, { name: "NEXT_LOCALE", value: "en", url: BASE }]);
  await context.addInitScript(({ auth }) => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("ey_hr_auth", JSON.stringify(auth));
  }, { auth });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error).split("\n")[0]));
  for (const [name, route] of [["setup.png", "/performance/year/setup"], ["year.png", "/performance"]]) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await settled(page, 3000);
    await page.screenshot({ path: path.join(OUT, name), fullPage: name === "setup.png" });
    console.log(`ok ${name} ${new URL(page.url()).pathname}${errors.length ? ` page errors: ${errors.join(" | ")}` : ""}`);
  }
  await context.close();
}

(async () => {
  const browser = await chromium.launch();
  await shoot(browser, "amira.khelifi");
  await browser.close();
})().catch((error) => { console.log("FAIL", String(error).split("\n")[0]); process.exit(1); });
