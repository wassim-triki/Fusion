#!/usr/bin/env node
/**
 * B-424 (slice 6): the 1:1 as the page, live through the shell, dark, 1440x900. On the `midyear` preset, as Mariam
 * Gharbi, a manager: her 1:1 with Aicha Bouazizi, the agenda from Aicha's year with its first line open. Writes
 * .local-docs/agents/plans/B-424-screens/meeting.png. Changes no data.
 * Usage: node .local-docs/agents/data/screens-b424-meeting.cjs
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const helper = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");
const presets = require("./demo-presets.local.json");

const BASE = "http://localhost:3000";
const PASSWORD = process.env.FUSION_LOCAL_PASSWORD;
const preset = (name) => (presets.presets?.[name] ?? presets[name]);
const OUT = path.join(__dirname, "..", "plans", "B-424-screens");
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

async function shot(browser, session, address, name, theme = "dark", open = null) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
  await context.addCookies([{ name: "ey_hr_authenticated", value: "true", url: BASE }, { name: "NEXT_LOCALE", value: "en", url: BASE }]);
  await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); localStorage.setItem("ey_hr_auth", JSON.stringify(auth)); }, { auth: session.auth, theme });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("page error:", String(error).split("\n")[0]));
  await page.goto(`${BASE}/performance${address}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"], .animate-pulse, [data-slot="skeleton"]'), null, { timeout: 90_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  if (open) await page.getByText(open, { exact: false }).first().click().catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, name) });
  console.log("ok", name);
  await context.close();
}

(async () => {
  const browser = await chromium.launch();
  const mid = preset("midyear");
  const mariam = await signIn(`mariam.gharbi@${mid.domain}`);
  const list = await helper.call("GET", "/api/performance/one-on-ones", null, mariam.token);
  const row = list.json.data.reports.find((r) => r.with.displayName.startsWith("Aicha"));
  const series = (await helper.call("GET", `/api/performance/one-on-ones/${row.seriesId}`, null, mariam.token)).json.data;
  const first = series.upcoming?.suggestions[0]?.label ?? null;
  await shot(browser, mariam, `/one-on-ones/${row.seriesId}`, "meeting.png", "dark", first);
  await browser.close();
})().catch((error) => { console.log("FAIL", String(error).split("\n")[0]); process.exit(1); });
