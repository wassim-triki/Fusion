#!/usr/bin/env node
/**
 * B-405 slice 3 (the Year page): one screen per viewer live through the shell, dark, 1440x900, on the `planning`
 * preset: Amira Khelifi (the administrator), Mariam Gharbi (a manager), Aicha Bouazizi (an employee whose plan waits
 * on Mariam). Writes .local-docs/agents/plans/B-405-screens/year-{amira,mariam,aicha}.png. Changes no data.
 * Usage: node .local-docs/agents/data/screens-b405-year.cjs [domain]   (default: the planning preset's domain)
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const helper = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");
const presets = require("./demo-presets.local.json");

const BASE = "http://localhost:3000";
const PASSWORD = process.env.FUSION_LOCAL_PASSWORD;
const DOMAIN = process.argv[2] ?? (presets.presets?.planning ?? presets.planning).domain;
const OUT = path.join(__dirname, "..", "plans", "B-405-screens");
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
  await page.goto(`${BASE}/performance`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await settled(page, 2500);
  const name = `year-${who.split(".")[0]}.png`;
  await page.screenshot({ path: path.join(OUT, name) });
  console.log(`ok ${name} ${new URL(page.url()).pathname}${errors.length ? ` page errors: ${errors.join(" | ")}` : ""}`);
  await context.close();
}

(async () => {
  const browser = await chromium.launch();
  for (const who of ["amira.khelifi", "mariam.gharbi", "aicha.bouazizi"]) await shoot(browser, who);
  await browser.close();
})().catch((error) => { console.log("FAIL", String(error).split("\n")[0]); process.exit(1); });
