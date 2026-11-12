#!/usr/bin/env node
/**
 * B-438 (slice 11, Competencies by job), live through the shell, dark, 1440x900, on the `midyear` preset as Amira Khelifi,
 * the administrator: writes a few expectations for the first job family with people (the drawing's Engineering cells, only
 * where a cell is empty), opens Settings › Competencies, drafts the empty cells when suggestions are on, opens one competency's ladder and
 * takes `competencies.png`. Writes .local-docs/agents/plans/B-438-screens/. Drafts are never applied.
 * Usage: node .local-docs/agents/data/screens-b438-competencies.cjs
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const helper = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");
const presets = require("./demo-presets.local.json");

const BASE = "http://localhost:3000";
const PASSWORD = process.env.FUSION_LOCAL_PASSWORD;
const preset = (name) => (presets.presets?.[name] ?? presets[name]);
const OUT = path.join(__dirname, "..", "plans", "B-438-screens");
fs.mkdirSync(OUT, { recursive: true });

// The drawing's words (B-412 ending › Competencies), level by level, for the first three levels of a family.
const WORDS = {
  "data-informed decision making": ["Uses the measures the team already tracks", "Chooses meaningful measures; explains trade-offs", "Sets the measures the team tracks quality by"],
  "inclusive collaboration": ["Asks for context before starting", "Shares context openly; invites different views", "Brings other teams into decisions before they're made"],
  "secure engineering": [null, "Applies secure-by-design practices; raises risks early", "Reviews others' designs for security risks"],
  "customer partnership": [null, "Listens for underlying needs; closes feedback loops", "Owns a client's quality concerns end to end"],
  "systems thinking": [null, "Identifies dependencies; balances near and long term", "Shapes the test strategy across services"],
};

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

(async () => {
  const mid = preset("midyear");
  const amira = await signIn(`amira.khelifi@${mid.domain}`);
  const grid = (await helper.call("GET", "/api/performance/settings/competencies/by-job", null, amira.token)).json?.data;
  if (!grid) throw new Error("No grid");
  const family = grid.families.filter((f) => f.levels.length >= 3).sort((a, b) => b.people - a.people)[0];
  console.log("families", grid.families.map((f) => `${f.label} ${f.people} [${f.levels.map((l) => l.label).join(", ")}]`).join(" | "));
  const written = new Set(grid.expectations.filter((e) => e.familyId === family.id).map((e) => `${e.competencyId}:${e.levelId}`));
  const cells = grid.competencies.flatMap((c) => (WORDS[c.name.toLowerCase()] ?? []).map((text, i) => ({ competencyId: c.id, levelId: family.levels[i]?.id, text, source: "Written" })))
    .filter((cell) => cell.text && cell.levelId && !written.has(`${cell.competencyId}:${cell.levelId}`));
  if (cells.length) {
    const saved = await helper.call("PUT", "/api/performance/settings/competencies/expectations", { familyId: family.id, cells }, amira.token);
    console.log("wrote", cells.length, saved.status);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await context.addCookies([{ name: "ey_hr_authenticated", value: "true", url: BASE }, { name: "NEXT_LOCALE", value: "en", url: BASE }]);
  await context.addInitScript(({ auth }) => { localStorage.setItem("theme", "dark"); localStorage.setItem("ey_hr_auth", JSON.stringify(auth)); }, { auth: amira.auth });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("page error:", String(error).split("\n")[0]));
  await page.goto(`${BASE}/performance/settings/competencies`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await page.getByRole("heading", { name: /level by level/ }).waitFor({ timeout: 300_000 });
  await page.getByRole("button", { name: new RegExp(`^${family.label}`) }).first().click().catch(() => {});
  const draft = page.getByRole("button", { name: "Draft the empty ones" });
  if (await draft.isVisible().catch(() => false)) {
    await draft.click();
    await page.getByText(/drafts? to look at|Nothing to draft|aren't available/).first().waitFor({ timeout: 30_000 }).catch(() => {});
  }
  // The ladder (D-101): open Inclusive Collaboration, written low and drafted high.
  await page.getByRole("button", { name: /^Inclusive Collaboration/i }).first().click().catch(() => {});
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, "competencies.png"), fullPage: false });
  console.log("ok competencies.png");
  await browser.close();
})().catch((error) => { console.log("FAIL", String(error).split("\n")[0]); process.exit(1); });
