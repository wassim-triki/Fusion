#!/usr/bin/env node
/**
 * B-454 and its siblings (queue row 3): the review page made clear, live through the shell, dark, 1440 wide, the whole
 * page. On the `yearend` preset: Mariam Gharbi, the manager, on Aicha Bouazizi's review (what it waits on, where each
 * part comes from, goals as shares of their targets, drafts marked as AI, the year column's icons). Writes
 * .local-docs/agents/plans/B-431-screens/review-clear.png. Changes no data (drafts may be generated and saved as the
 * manager's draft).
 * Usage: node .local-docs/agents/data/screens-b454-review-clear.cjs
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const helper = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");
const presets = require("./demo-presets.local.json");

const BASE = "http://localhost:3000";
const preset = (name) => (presets.presets?.[name] ?? presets[name]);
const OUT = path.join(__dirname, "..", "plans", "B-431-screens");
fs.mkdirSync(OUT, { recursive: true });

async function signIn(email) {
  const response = await helper.call("POST", "/api/identity/auth/login", { email, password: process.env.FUSION_LOCAL_PASSWORD });
  if (response.status !== 200) throw new Error(`Sign-in failed for ${email}: ${response.status}`);
  const d = response.json.data;
  return { token: d.accessToken, auth: { accessToken: d.accessToken, refreshToken: d.refreshToken, accessTokenExpiration: d.accessTokenExpiration,
    user: { userId: d.userId, tenantId: d.tenantId ?? null, tenantMembershipId: d.tenantMembershipId ?? null,
      moduleEntitlements: d.moduleEntitlements ?? [], email: d.email, fullName: d.fullName, roles: d.roles,
      employeeId: d.employeeId ?? null, accessProfiles: d.accessProfiles ?? [], effectivePermissions: d.effectivePermissions ?? [],
      language: d.language, notificationPopups: d.notificationPopups, notificationSound: d.notificationSound } } };
}

(async () => {
  const end = preset("yearend");
  const aicha = await signIn(`aicha.bouazizi@${end.domain}`);
  const workspace = await (await fetch(`${BASE}/api/performance/reviews/workspace`, { headers: { Authorization: `Bearer ${aicha.token}` } })).json();
  const reviewId = workspace.data.own.reviewId;
  const mariam = await signIn(`mariam.gharbi@${end.domain}`);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await context.addCookies([{ name: "ey_hr_authenticated", value: "true", url: BASE }, { name: "NEXT_LOCALE", value: "en", url: BASE }]);
  await context.addInitScript(({ auth }) => { localStorage.setItem("theme", "dark"); localStorage.setItem("ey_hr_auth", JSON.stringify(auth)); }, { auth: mariam.auth });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("page error:", String(error).split("\n")[0]));
  await page.goto(`${BASE}/performance/reviews/${reviewId}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await page.waitForSelector("text=Aicha's year", { timeout: 240_000 });
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"], .animate-pulse, [data-slot="skeleton"]'), null, { timeout: 120_000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(OUT, "review-clear.png"), fullPage: true });
  console.log("ok review-clear.png");
  await browser.close();
})().catch((error) => { console.log("FAIL", String(error).split("\n")[0]); process.exit(1); });
