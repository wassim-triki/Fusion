#!/usr/bin/env node
/**
 * B-406 slice 5 part 1 (the goal panel and the progress dialog): screens live through the shell, dark, 1440x900.
 * On the `midyear` preset: Aicha Bouazizi's first goal opened as the panel over My plan, then the update dialog over it,
 * and Amira Khelifi (the administrator) opening a company goal. On the `planning` preset: Aicha's just-written goal.
 * Writes .local-docs/agents/plans/B-406-screens/*.png. Changes no data (the dialog is opened, never saved).
 * Usage: node .local-docs/agents/data/screens-b406-goal-panel.cjs
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const helper = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");
const presets = require("./demo-presets.local.json");

const BASE = "http://localhost:3000";
const PASSWORD = process.env.FUSION_LOCAL_PASSWORD;
const preset = (name) => (presets.presets?.[name] ?? presets[name]);
const OUT = path.join(__dirname, "..", "plans", "B-406-screens");
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

async function settled(page, settle = 2000) {
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"], .animate-pulse, [data-slot="skeleton"]'), null, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(settle);
}

async function browse(browser, session) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await context.addCookies([{ name: "ey_hr_authenticated", value: "true", url: BASE }, { name: "NEXT_LOCALE", value: "en", url: BASE }]);
  await context.addInitScript(({ auth }) => { localStorage.setItem("theme", "dark"); localStorage.setItem("ey_hr_auth", JSON.stringify(auth)); }, { auth: session.auth });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("page error:", String(error).split("\n")[0]));
  return { context, page };
}

/** Opens a goal the way a person does: its link on the page, so the record intercepts as a panel over it. */
async function openPanel(page, from, cycleId, objectiveId, title) {
  await page.goto(`${BASE}/performance${from}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await settled(page, 2000);
  const link = page.locator(`a[href*="/objectives/${objectiveId}"]`).first();
  const view = page.getByRole("button", { name: `View ${title}`, exact: true }).or(page.getByRole("button", { name: `Open ${title}`, exact: true })).first();
  const row = page.getByText(title, { exact: true }).first();
  if (title && await view.count()) await view.click();
  else if (title && await row.count()) {
    // Goals lists a goal as a row; its open control sits beside the title.
    await row.click();
    await page.waitForTimeout(800);
    const open = page.getByRole("button", { name: "Open objective" }).first();
    if (await open.count()) await open.click();
  }
  else if (await link.count()) await link.click();
  else {
    // No link to it on this page: navigate client-side through a link Next owns.
    await page.evaluate((href) => {
      const a = document.querySelector('a[href^="/performance/"]');
      if (a) { a.setAttribute("href", href); a.click(); }
    }, `/performance/cycles/${cycleId}/objectives/${objectiveId}`);
  }
  await page.waitForSelector('[role="dialog"]', { timeout: 30_000 }).catch(() => console.log("no panel opened"));
  await settled(page, 2500);
}

async function myFirstGoal(session, cycleId) {
  const plan = await helper.call("GET", `/api/performance/cycles/${cycleId}/plan`, undefined, session.token);
  const goals = plan.json?.data?.plan?.objectives ?? [];
  if (!goals.length) throw new Error("No goals in the plan");
  return goals[0];
}

(async () => {
  const browser = await chromium.launch();
  const mid = preset("midyear");
  const aicha = await signIn(`aicha.bouazizi@${mid.domain}`);
  const midCycle = mid.cycles.current.id;
  const goal = await myFirstGoal(aicha, midCycle);
  {
    const { context, page } = await browse(browser, aicha);
    await openPanel(page, `/plan?cycle=${midCycle}`, midCycle, goal.id, goal.title);
    await page.screenshot({ path: path.join(OUT, "panel-midyear.png") });
    console.log("ok panel-midyear.png");
    const update = page.getByRole("dialog").getByRole("button", { name: "Update progress" }).first();
    if (await update.isVisible().catch(() => false)) {
      await update.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(OUT, "progress-dialog.png") });
      console.log("ok progress-dialog.png");
    } else console.log("no Update progress button");
    await context.close();
  }
  {
    const amira = await signIn(`amira.khelifi@${mid.domain}`);
    const goals = await helper.call("GET", `/api/performance/cycles/${midCycle}/goals`, undefined, amira.token);
    const company = (goals.json?.data?.nodes ?? []).find((n) => n.ownershipScope === "Company" && n.childCount > 0)
      ?? (goals.json?.data?.nodes ?? []).find((n) => n.ownershipScope === "Company");
    const { context, page } = await browse(browser, amira);
    await openPanel(page, `/goals?cycle=${midCycle}`, midCycle, company.id, company.title);
    await page.screenshot({ path: path.join(OUT, "panel-company.png") });
    console.log("ok panel-company.png");
    await context.close();
  }
  {
    const plan = preset("planning");
    const aichaPlanning = await signIn(`aicha.bouazizi@${plan.domain}`);
    const cycle = plan.cycles.current.id;
    const draft = await myFirstGoal(aichaPlanning, cycle);
    const { context, page } = await browse(browser, aichaPlanning);
    await openPanel(page, `/plan?cycle=${cycle}`, cycle, draft.id, draft.title);
    await page.screenshot({ path: path.join(OUT, "panel-just-written.png") });
    console.log("ok panel-just-written.png");
    await context.close();
  }
  await browser.close();
})().catch((error) => { console.log("FAIL", String(error).split("\n")[0]); process.exit(1); });
