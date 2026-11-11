#!/usr/bin/env node
/**
 * B-431 (slice 8): Reviews, live through the shell, dark, 1440x900. On the `yearend` preset (round ten days in, Aicha's
 * self-review still out): the Year page as Amira Khelifi, the administrator (managers furthest behind with nudges);
 * Aicha Bouazizi's self-review; Mariam Gharbi, the manager, on Aicha's review (drafted, what it waits on); Home as a
 * colleague asked for their view. On `nextcycle`: Aicha's released review read as a letter. Writes
 * .local-docs/agents/plans/B-431-screens/. Changes no data (drafts may be generated and saved as the manager's draft).
 * Usage: node .local-docs/agents/data/screens-b431-reviews.cjs
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const helper = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");
const presets = require("./demo-presets.local.json");

const BASE = "http://localhost:3000";
const PASSWORD = process.env.FUSION_LOCAL_PASSWORD;
const preset = (name) => (presets.presets?.[name] ?? presets[name]);
const OUT = path.join(__dirname, "..", "plans", "B-431-screens");
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
  const json = await response.json();
  return json.data;
}

async function shot(browser, session, address, name, ready) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await context.addCookies([{ name: "ey_hr_authenticated", value: "true", url: BASE }, { name: "NEXT_LOCALE", value: "en", url: BASE }]);
  await context.addInitScript(({ auth }) => { localStorage.setItem("theme", "dark"); localStorage.setItem("ey_hr_auth", JSON.stringify(auth)); }, { auth: session.auth });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("page error:", String(error).split("\n")[0]));
  await page.goto(`${BASE}${address}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"], .animate-pulse, [data-slot="skeleton"]'), null, { timeout: 90_000 }).catch(() => {});
  await page.waitForSelector(ready, { timeout: 120_000 }).catch(() => console.log("not ready:", ready));
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(OUT, name) });
  console.log("ok", name);
  await context.close();
}

(async () => {
  const browser = await chromium.launch();
  const end = preset("yearend");
  const amira = await signIn(`amira.khelifi@${end.domain}`);
  await shot(browser, amira, "/performance", "year-round.png", "text=written");
  const aicha = await signIn(`aicha.bouazizi@${end.domain}`);
  const own = (await get(aicha, "/api/performance/reviews/workspace")).own;
  await shot(browser, aicha, `/performance/reviews/${own.reviewId}`, "self-review.png", "text=Your year");
  const mariam = await signIn(`mariam.gharbi@${end.domain}`);
  await shot(browser, mariam, `/performance/reviews/${own.reviewId}`, "manager-review.png", "text=Aicha's year");
  // A colleague with an open request, answered on Home.
  for (const who of ["khaled.sassi", "leila.baccouche", "rim.mahjoub", "omar.mansour", "aicha.bouazizi", "mariam.gharbi", "amira.khelifi"]) {
    const s = await signIn(`${who}@${end.domain}`);
    const asked = (await get(s, "/api/performance/reviews/workspace")).askedOfYou.find((a) => a.state === "Open");
    if (!asked) continue;
    await shot(browser, s, `/?peer=${asked.requestId}`, "home-peer.png", "text=Why you");
    break;
  }
  const next = preset("nextcycle");
  const aichaNext = await signIn(`aicha.bouazizi@${next.domain}`);
  const past = (await get(aichaNext, "/api/performance/reviews/workspace")).pastResults[0];
  if (past) await shot(browser, aichaNext, `/performance/reviews/${past.reviewId}`, "letter.png", "text=Overall, from");
  await browser.close();
})().catch((error) => { console.log("FAIL", String(error).split("\n")[0]); process.exit(1); });
