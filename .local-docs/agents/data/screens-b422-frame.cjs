#!/usr/bin/env node
/**
 * B-422 (Performance slice 1, the frame): one screen of the new frame live through the shell, dark, 1440x900:
 * Core HR as Amira (walkthrough company) with the one sidebar's groups and your menu open top right.
 * Writes .local-docs/agents/plans/B-422-screens/frame.png. Changes no data.
 * Usage: node .local-docs/agents/data/screens-b422-frame.cjs
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const helper = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");

const BASE = "http://localhost:3000";
const PASSWORD = process.env.FUSION_LOCAL_PASSWORD;
const EMAIL = process.env.B422_EMAIL ?? "amira.khelifi@walkthrough-202611082348.example.test";
const OUT = path.join(__dirname, "..", "plans", "B-422-screens");
fs.mkdirSync(OUT, { recursive: true });

async function settled(page, settle = 2000) {
  await page.waitForTimeout(1500);
  await page.waitForFunction(
    () => !document.querySelector('[aria-busy="true"], .animate-pulse, [data-slot="skeleton"]'),
    null, { timeout: 60_000 },
  ).catch(() => {});
  await page.waitForTimeout(settle);
}

(async () => {
  const response = await helper.call("POST", "/api/identity/auth/login", { email: EMAIL, password: PASSWORD });
  if (response.status !== 200) throw new Error(`Sign-in failed for ${EMAIL}: ${response.status}`);
  const d = response.json.data;
  const auth = { accessToken: d.accessToken, refreshToken: d.refreshToken, accessTokenExpiration: d.accessTokenExpiration,
    user: { userId: d.userId, tenantId: d.tenantId ?? null, tenantMembershipId: d.tenantMembershipId ?? null,
      moduleEntitlements: d.moduleEntitlements ?? [], email: d.email, fullName: d.fullName, roles: d.roles,
      employeeId: d.employeeId ?? null, accessProfiles: d.accessProfiles ?? [], effectivePermissions: d.effectivePermissions ?? [],
      language: d.language, notificationPopups: d.notificationPopups, notificationSound: d.notificationSound } };
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await context.addCookies([{ name: "ey_hr_authenticated", value: "true", url: BASE }, { name: "NEXT_LOCALE", value: "en", url: BASE }]);
  await context.addInitScript(({ auth }) => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("ey_hr_auth", JSON.stringify(auth));
  }, { auth });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error).split("\n")[0]));
  await page.goto(`${BASE}/core`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await settled(page, 2500);
  await page.getByRole("button", { name: "Your menu" }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, "frame.png") });
  console.log(`ok frame.png ${new URL(page.url()).pathname}`);
  if (errors.length) console.log("page errors:", errors.join(" | "));
  await browser.close();
})().catch((error) => { console.log("FAIL", String(error).split("\n")[0]); process.exit(1); });
