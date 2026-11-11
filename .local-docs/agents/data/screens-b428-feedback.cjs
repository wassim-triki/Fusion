#!/usr/bin/env node
/**
 * B-428 (slice 7): Feedback and praise, live through the shell, dark, 1440x900. On the `midyear` preset: Feedback's
 * Praise tab as Aicha Bouazizi, an employee (the composer, the week's wall, values this month, asked of you), and
 * Settings › Values as Amira Khelifi, the administrator. Writes .local-docs/agents/plans/B-428-screens/. Changes no data.
 * Usage: node .local-docs/agents/data/screens-b428-feedback.cjs
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const helper = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");
const presets = require("./demo-presets.local.json");

const BASE = "http://localhost:3000";
const PASSWORD = process.env.FUSION_LOCAL_PASSWORD;
const preset = (name) => (presets.presets?.[name] ?? presets[name]);
const OUT = path.join(__dirname, "..", "plans", "B-428-screens");
fs.mkdirSync(OUT, { recursive: true });

async function signIn(email) {
  const response = await helper.call("POST", "/api/identity/auth/login", { email, password: PASSWORD });
  if (response.status !== 200) throw new Error(`Sign-in failed for ${email}: ${response.status}`);
  const d = response.json.data;
  return { token: d.accessToken, auth: { accessToken: d.accessToken, refreshToken: d.refreshToken, accessTokenExpiration: d.accessTokenExpiration,
    user: { userId: d.userId, tenantId: d.tenantId ?? null, tenantMembershipId: d.tenantMembershipId ?? null,
      moduleEntitlements: d.moduleEntitlements ?? [], email: d.email, fullName: d.fullName, roles: d.roles,
      employeeId: d.employeeId ?? null, accessProfiles: d.accessProfiles ?? [], effectivePermissions: d.effectivePermissions ?? [],
      language: d.language, notificationPopups: d.notificationPopups, notificationSound: d.notificationSound } } };
}

async function shot(browser, session, address, name, ready, theme = "dark") {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
  await context.addCookies([{ name: "ey_hr_authenticated", value: "true", url: BASE }, { name: "NEXT_LOCALE", value: "en", url: BASE }]);
  await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); localStorage.setItem("ey_hr_auth", JSON.stringify(auth)); }, { auth: session.auth, theme });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("page error:", String(error).split("\n")[0]));
  await page.goto(`${BASE}/performance${address}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"], .animate-pulse, [data-slot="skeleton"]'), null, { timeout: 90_000 }).catch(() => {});
  await page.waitForSelector(ready, { timeout: 120_000 }).catch(() => console.log("not ready:", ready));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, name) });
  console.log("ok", name);
  await context.close();
}

(async () => {
  const browser = await chromium.launch();
  const mid = preset("midyear");
  const aicha = await signIn(`aicha.bouazizi@${mid.domain}`);
  await shot(browser, aicha, "/feedback", "praise.png", '[role="radio"]');
  const amira = await signIn(`amira.khelifi@${mid.domain}`);
  await shot(browser, amira, "/settings/values", "values.png", "text=Own the outcome");
  await browser.close();
})().catch((error) => { console.log("FAIL", String(error).split("\n")[0]); process.exit(1); });
