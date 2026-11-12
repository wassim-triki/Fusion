#!/usr/bin/env node
/**
 * B-434 (slice 10, Across Fusion), live through the shell, dark, 1440x900, on the `midyear` preset as Mariam Gharbi, a
 * manager: Team's Performance tab (`team.png`), Aicha Bouazizi's person page on its Performance tab (`person.png`) and
 * Home's Needs you answered in place (`home.png`). Writes .local-docs/agents/plans/B-434-screens/. Changes no data.
 * Usage: node .local-docs/agents/data/screens-b434-across.cjs
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const helper = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");
const presets = require("./demo-presets.local.json");

const BASE = "http://localhost:3000";
const PASSWORD = process.env.FUSION_LOCAL_PASSWORD;
const preset = (name) => (presets.presets?.[name] ?? presets[name]);
const OUT = path.join(__dirname, "..", "plans", "B-434-screens");
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

async function shot(browser, session, address, name) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await context.addCookies([{ name: "ey_hr_authenticated", value: "true", url: BASE }, { name: "NEXT_LOCALE", value: "en", url: BASE }]);
  await context.addInitScript(({ auth }) => { localStorage.setItem("theme", "dark"); localStorage.setItem("ey_hr_auth", JSON.stringify(auth)); }, { auth: session.auth });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("page error:", String(error).split("\n")[0]));
  await page.goto(`${BASE}${address}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"], .animate-pulse, [data-slot="skeleton"]'), null, { timeout: 120_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, name) });
  console.log("ok", name);
  await context.close();
}

(async () => {
  const browser = await chromium.launch();
  const mid = preset("midyear");
  const mariam = await signIn(`mariam.gharbi@${mid.domain}`);
  const context = (await helper.call("GET", "/api/performance/context", null, mariam.token)).json?.data;
  const cycleId = context?.selected?.id;
  const year = (await helper.call("GET", `/api/performance/cycles/${cycleId}/team/year`, null, mariam.token)).json.data;
  const aicha = year.people.find((person) => person.name.startsWith("Aicha"));
  console.log("team", year.people.map((p) => `${p.name}: ${p.due?.kind ?? "-"}`).join(", "), "| branches", year.branches.length);
  await shot(browser, mariam, "/performance/team", "team.png");
  await shot(browser, mariam, `/core/people/${encodeURIComponent(aicha.stableEmployeeKey)}?tab=performance`, "person.png");
  await shot(browser, mariam, "/", "home.png");
  await browser.close();
})().catch((error) => { console.log("FAIL", String(error).split("\n")[0]); process.exit(1); });
