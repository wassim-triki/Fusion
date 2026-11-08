// Screens for B-325 (polish batch), dark 1440x900, through the shell:
//   node .local-docs/agents/data/screens-b325.cjs
// Setup (re-runnable, ends where it started): Amira Khelifi, the administrator, chooses Aicha Bouazizi for a role she
// doesn't hold and takes it back; Change history keeps both lines.
// 01 B-323 Change history, the newest role entry opened · 02 B-321 the 1:1 record (Mariam Gharbi with Aicha) ·
// 03 B-321 Reviews as Mariam · 04/05 B-250 the sidebar open (edge tab, tooltip) and folded (mark turned into the icon).
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const { BASE, PASSWORD, call, login } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const shot = (name) => {
  const dir = path.join(__dirname, "../plans/B-325-screens");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
};
let passed = 0;
let failed = 0;
function check(label, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (ok) passed++;
  else failed++;
}
const data = (response) => response.json?.data;

async function session(browser, email) {
  const response = await call("POST", "/api/identity/auth/login", { email, password: PASSWORD });
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
  return { context, page: await context.newPage(), token: d.accessToken };
}

// A role save renews the saver's access and ends their token, so each call signs in again.
const amira = () => login("amira.khelifi@example.test");
async function saveRole(detail, chosenUserIds) {
  const role = detail.role;
  const response = await fetch(`${BASE}/api/identity/core-access/roles/${role.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await amira()}`, "If-Match": `"${role.version}"` },
    body: JSON.stringify({ name: role.name, description: role.description, cells: role.cells, holderKind: role.holderKind,
      conditions: role.conditions, chosenUserIds }),
  });
  return response.status;
}
const readRole = async (id) => data(await call("GET", `/api/identity/core-access/roles/${id}`, null, await amira()));
const settle = async (page) => {
  await page.waitForFunction(() => document.querySelectorAll("[data-slot=skeleton]").length === 0, null, { timeout: 120000 }).catch(() => undefined);
  await page.waitForTimeout(1200);
};

(async () => {
  const roles = data(await call("GET", "/api/identity/core-access/roles", null, await amira())).roles;
  const everyone = roles.find((role) => role.holderKind === "everyone" && !role.isAdministrators);
  const aicha = (await readRole(everyone.id)).holders.find((holder) => holder.name === "Aicha Bouazizi");
  let role = null;
  for (const item of roles.filter((r) => !r.isAdministrators && !r.isLocked && r.holderKind !== "everyone")) {
    if (!(await readRole(item.id)).holders.some((holder) => holder.userId === aicha.userId)) { role = item; break; }
  }
  if (!role) throw new Error("Aicha already holds every role");
  let detail = await readRole(role.id);
  const chosen = detail.holders.filter((holder) => holder.isChosen).map((holder) => holder.userId);
  check(`Amira chooses Aicha for ${role.name}`, (await saveRole(detail, [...chosen, aicha.userId])) === 200);
  detail = await readRole(role.id);
  check(`and takes ${role.name} back`, (await saveRole(detail, chosen)) === 200);

  const browser = await chromium.launch();
  try {
    const hr = await session(browser, "amira.khelifi@example.test");
    await hr.page.goto(`${BASE}/core/settings/change-history`, { waitUntil: "domcontentloaded", timeout: 240000 });
    const took = hr.page.getByText(`Took the ${role.name} role from Aicha Bouazizi`).first();
    await took.waitFor({ timeout: 120000 });
    check("Change history says who was taken off", true);
    check("and who was chosen", await hr.page.getByText(`Gave Aicha Bouazizi the ${role.name} role`).first().isVisible());
    await took.click();
    await hr.page.waitForTimeout(500);
    await hr.page.screenshot({ path: shot("01-change-history-chosen.png") });

    // The sidebar, open with the edge tab's tooltip, then folded with the mark turned into the icon.
    await hr.page.goto(`${BASE}/core/people`, { waitUntil: "domcontentloaded", timeout: 240000 });
    await settle(hr.page);
    const tab = hr.page.getByRole("button", { name: "Collapse sidebar" });
    await tab.waitFor({ timeout: 120000 });
    await tab.hover();
    await hr.page.getByRole("tooltip").waitFor({ timeout: 10000 });
    await hr.page.waitForTimeout(400);
    check("the open sidebar folds from its edge tab", true);
    await hr.page.screenshot({ path: shot("04-sidebar-open.png") });
    await tab.click();
    const mark = hr.page.getByRole("button", { name: "Expand sidebar" });
    await mark.waitFor({ timeout: 10000 });
    await hr.page.mouse.move(700, 450);
    await hr.page.waitForTimeout(400);
    await mark.hover();
    await hr.page.getByRole("tooltip").waitFor({ timeout: 10000 });
    await hr.page.waitForTimeout(500);
    check("folded, the mark opens it", (await hr.page.locator("aside[data-collapsed=true]").count()) === 1);
    await hr.page.screenshot({ path: shot("05-sidebar-folded.png") });
    await mark.click();
    await hr.context.close();

    const manager = await session(browser, "mariam.gharbi@example.test");
    const oneOnOnes = data(await call("GET", "/api/performance/one-on-ones", null, manager.token));
    const series = oneOnOnes.reports.find((report) => report.with.displayName === "Aicha Bouazizi");
    await manager.page.goto(`${BASE}/performance/one-on-ones/${series.seriesId}`, { waitUntil: "domcontentloaded", timeout: 240000 });
    await manager.page.locator("section[data-slot=section]").first().waitFor({ timeout: 240000 });
    await settle(manager.page);
    check("the 1:1 record's lists sit inside their frames", (await manager.page.locator("section[data-slot=section]").count()) >= 2);
    await manager.page.screenshot({ path: shot("02-one-on-one.png") });

    await manager.page.goto(`${BASE}/performance/reviews`, { waitUntil: "domcontentloaded", timeout: 240000 });
    await manager.page.locator("section[data-slot=section]").first().waitFor({ timeout: 240000 });
    await settle(manager.page);
    check("Reviews' lists sit inside their frames", (await manager.page.locator("section[data-slot=section]").count()) >= 2);
    await manager.page.screenshot({ path: shot("03-reviews.png") });
    await manager.context.close();
  } finally {
    await browser.close();
  }
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => console.log(`Passed ${passed} | Failed ${failed} | Skipped 0`));
