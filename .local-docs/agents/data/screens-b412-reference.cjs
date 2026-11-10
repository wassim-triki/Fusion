#!/usr/bin/env node
/**
 * B-412 (checkpoint 3a) reference screens: the surfaces plans/B-390-design-direction.md §4 names as references,
 * live through the shell (dark, 1440x900, viewport shots) into .local-docs/agents/plans/B-412-screens/reference/.
 * Checkpoint 3b adds the objective drawer as built (details and record modes), which the user liked.
 * Carthage · Mid-year for most; Carthage · Next cycle for cycle setup. Changes no data.
 * Usage: node .local-docs/agents/data/screens-b412-reference.cjs   (B412_FORCE=1 retakes existing shots)
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const helper = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");

const BASE = "http://localhost:3000";
const PASSWORD = process.env.FUSION_LOCAL_PASSWORD;
const OUT = path.join(__dirname, "..", "plans", "B-412-screens", "reference");
const MID = "midyear-5.example.test";
const NEXT = "nextcycle-2.example.test";
fs.mkdirSync(OUT, { recursive: true });
let failed = 0;

async function settled(page, settle = 2000) {
  await page.waitForTimeout(1500);
  await page.waitForFunction(
    () => !document.querySelector('[aria-busy="true"], .animate-pulse, [data-slot="skeleton"]'),
    null, { timeout: 45_000 },
  ).catch(() => {});
  await page.waitForTimeout(settle);
}

const exists = (key) => fs.existsSync(path.join(OUT, `${key}.png`)) && process.env.B412_FORCE !== "1";

async function visit(page, key, url, settle, then) {
  if (exists(key)) return;
  try {
    await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await settled(page, settle);
    if (then) { await then(page); await settled(page, 1500); }
    await page.screenshot({ path: path.join(OUT, `${key}.png`) });
    console.log(`  ok   ${key}  ${new URL(page.url()).pathname}${new URL(page.url()).search}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${key}  ${String(error).split("\n")[0].slice(0, 160)}`);
  }
}

async function as(browser, email, run) {
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
  try { await run(page); } finally { await context.close(); }
}

(async () => {
  const amira = `amira.khelifi@${MID}`;
  const token = await helper.login(amira);
  const found = await helper.call("GET", "/api/corehr/employees/people?pageSize=200", undefined, token);
  const aicha = found.json?.data?.items?.find((person) => person.firstName === "Aicha");
  const browser = await chromium.launch();
  try {
    await as(browser, amira, async (page) => {
      await visit(page, "core-front-page", "/core", 3000);
      await visit(page, "org-chart", "/core/org-chart", 3000);
      if (aicha) {
        await visit(page, "person-band-aicha", `/core/people/${aicha.employeeKey}`);
        await visit(page, "change-panel", `/core/people/${aicha.employeeKey}?change=job`);
      }
      await visit(page, "brand-studio", "/core/settings/brand");
      await visit(page, "fields", "/core/settings/employee-fields");
      await visit(page, "perf-feedback-praise", "/performance/feedback", 3000);
    });
    await as(browser, `mariam.gharbi@${MID}`, async (page) => {
      await visit(page, "home-mariam", "/", 3000);
      await visit(page, "team-mariam", "/core/team", 3000);
    });
    await as(browser, `aicha.bouazizi@${MID}`, async (page) => {
      await visit(page, "home-aicha", "/", 3000);
      const openGoal = async (p) => { await p.getByText("Automate the regression suite").first().click(); };
      await visit(page, "objective-drawer", "/performance/plan", 3000, openGoal);
      await visit(page, "objective-drawer-record", "/performance/plan", 3000, async (p) => {
        await openGoal(p); await p.waitForTimeout(2500);
        await p.getByRole("dialog").getByRole("button", { name: /update progress|record progress/i }).first().click();
      });
    });
    await as(browser, `amira.khelifi@${NEXT}`, async (page) => {
      await visit(page, "cycle-setup", "/performance/cycle/setup", 3000);
    });
  } finally {
    await browser.close();
  }
  console.log(failed ? `${failed} failed` : "all captured");
  process.exit(failed ? 1 : 0);
})();
