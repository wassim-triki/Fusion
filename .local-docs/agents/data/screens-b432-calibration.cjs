#!/usr/bin/env node
/**
 * B-432 (slice 9): calibration and release, live through the shell, dark, 1440x900, as Amira Khelifi, the administrator,
 * on the `yearend` preset: the Calibration page (flagged reviews, each with why), its full view (rating against goals'
 * grade), and the Year page with Release results previewed in place. Writes .local-docs/agents/plans/B-432-screens/.
 * Changes no data: the preview is cancelled, nothing is released.
 * Usage: node .local-docs/agents/data/screens-b432-calibration.cjs
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const helper = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");
const presets = require("./demo-presets.local.json");

const BASE = "http://localhost:3000";
const PASSWORD = process.env.FUSION_LOCAL_PASSWORD;
const preset = (name) => (presets.presets?.[name] ?? presets[name]);
const OUT = path.join(__dirname, "..", "plans", "B-432-screens");
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

async function get(session, address) {
  const response = await fetch(`${BASE}${address}`, { headers: { Authorization: `Bearer ${session.token}` } });
  return (await response.json()).data;
}

async function shot(browser, session, address, name, ready, act) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await context.addCookies([{ name: "ey_hr_authenticated", value: "true", url: BASE }, { name: "NEXT_LOCALE", value: "en", url: BASE }]);
  await context.addInitScript(({ auth }) => { localStorage.setItem("theme", "dark"); localStorage.setItem("ey_hr_auth", JSON.stringify(auth)); }, { auth: session.auth });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("page error:", String(error).split("\n")[0]));
  await page.goto(`${BASE}${address}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"], .animate-pulse, [data-slot="skeleton"]'), null, { timeout: 90_000 }).catch(() => {});
  await page.waitForSelector(ready, { timeout: 120_000 }).catch(() => console.log("not ready:", ready));
  if (act) await act(page);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(OUT, name) });
  console.log("ok", name);
  await context.close();
}

(async () => {
  const browser = await chromium.launch();
  const end = preset("yearend");
  const amira = await signIn(`amira.khelifi@${end.domain}`);
  const context = await get(amira, "/api/performance/context");
  const year = await get(amira, `/api/performance/cycles/${context.selected.id}/year`);
  const round = year.review.roundId;
  await shot(browser, amira, `/performance/reviews/rounds/${round}/calibration`, "calibration.png", "text=Calibration");
  await shot(browser, amira, `/performance/reviews/rounds/${round}/calibration?view=everyone`, "everyone.png", "text=Rating against goals");
  await shot(browser, amira, "/performance?release=1", "release.png", "text=Release results today");
  await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });
