// Screens for B-322 session 1, dark 1440x900, through the shell:
//   node .local-docs/agents/data/screens-b322.cjs
// Demo data first (re-runnable, ends where it started): Amira Khelifi, the administrator, chooses Aicha Bouazizi for a
// role and takes it back, and saves a new welcome line on Brand, then puts the old one back.
// 1. B-314: Aicha's Access › History as Amira, the role given and removed in view.
// 2. B-203: Settings › Change history as Amira, the Brand saves on top.
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const { BASE, PASSWORD, call, login } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const shot = (name) => {
  const dir = path.join(__dirname, "../plans/B-322-screens");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
};
let passed = 0;
let failed = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok || !detail ? "" : ` (${detail})`}`);
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
  await context.addInitScript(({ auth }) => { localStorage.setItem("theme", "dark"); localStorage.setItem("ey_hr_auth", JSON.stringify(auth)); }, { auth });
  return { context, page: await context.newPage(), token: d.accessToken };
}

async function saveRole(token, detail, chosenUserIds) {
  token = await login("amira.khelifi@example.test");
  const role = detail.role;
  const response = await fetch(`${BASE}/api/identity/core-access/roles/${role.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "If-Match": `"${role.version}"` },
    body: JSON.stringify({ name: role.name, description: role.description, cells: role.cells, holderKind: role.holderKind,
      conditions: role.conditions, chosenUserIds }),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

(async () => {
  const browser = await chromium.launch();
  try {
    // A role save renews Amira's access, which ends her token: each call signs in again; the browser opens after.
    const as = { get token() { return null; } };
    const amira = () => login("amira.khelifi@example.test");
    const hr = { token: null };
    Object.defineProperty(hr, "token", { get: () => as.current });
    as.current = await amira();
    const roles = data(await call("GET", "/api/identity/core-access/roles", null, hr.token)).roles;
    const everyone = roles.find((role) => role.holderKind === "everyone" && !role.isAdministrators);
    const aicha = data(await call("GET", `/api/identity/core-access/roles/${everyone.id}`, null, hr.token))
      .holders.find((holder) => holder.name === "Aicha Bouazizi");
    const readRole = async (id) => {
      as.current = await amira();
      const response = await call("GET", `/api/identity/core-access/roles/${id}`, null, hr.token);
      if (!data(response)) throw new Error(`Role ${id} didn't load: ${response.status}`);
      return data(response);
    };
    // No one chooses Aicha by name for any role, so each run starts the same (an earlier run chose her for Managers).
    for (const item of roles.filter((role) => !role.isAdministrators && !role.isLocked)) {
      const detail = await readRole(item.id);
      if (detail.holders.some((holder) => holder.userId === aicha.userId && holder.isChosen))
        await saveRole(hr.token, detail, detail.holders.filter((h) => h.isChosen && h.userId !== aicha.userId).map((h) => h.userId));
    }
    let role = null;
    for (const item of roles.filter((r) => !r.isAdministrators && !r.isLocked && r.holderKind !== "everyone")) {
      if (!(await readRole(item.id)).holders.some((holder) => holder.userId === aicha.userId)) { role = item; break; }
    }
    if (!role) throw new Error("Aicha already holds every role");
    let detail = await readRole(role.id);
    const chosen = detail.holders.filter((holder) => holder.isChosen).map((holder) => holder.userId);
    check(`Amira chooses Aicha for ${role.name}`, (await saveRole(hr.token, detail, [...chosen, aicha.userId])).status === 200);
    detail = await readRole(role.id);
    check(`and takes ${role.name} back`, (await saveRole(hr.token, detail, chosen)).status === 200);

    as.current = await amira();
    const summary = data(await call("GET", "/api/identity/tenant-context/tenant-summary", null, hr.token));
    const brand = (welcomeLine) => call("PUT", "/api/identity/brand", { name: summary.name, color: summary.brandColor ?? null,
      language: summary.language ?? "en", logo: "keep", welcomeLine }, hr.token);
    check("Amira saves a new welcome line", (await brand("Welcome back. Your day starts here.")).status === 200);
    check("and puts the old one back", (await brand(summary.welcomeLine ?? null)).status === 200);

    const page = await session(browser, "amira.khelifi@example.test");
    const people = data(await call("GET", "/api/corehr/reports/front-page", null, page.token)).people;
    const key = people.find((person) => person.name === "Aicha Bouazizi").employeeKey;
    await page.page.goto(`${BASE}/core/people/${key}?tab=access`, { waitUntil: "domcontentloaded", timeout: 240000 });
    const heading = page.page.getByRole("heading", { name: "History" });
    await heading.waitFor({ timeout: 240000 });
    const given = page.page.getByText(`Given the ${role.name} role by Amira Khelifi`).first();
    await given.waitFor({ timeout: 60000 });
    await heading.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.page.waitForTimeout(800);
    check("History tells the role given and removed", await page.page.getByText(`${role.name} role removed by Amira Khelifi`).first().isVisible());
    await page.page.screenshot({ path: shot("01-access-history-roles.png") });

    await page.page.goto(`${BASE}/core/settings/change-history`, { waitUntil: "domcontentloaded", timeout: 240000 });
    const entry = page.page.getByText("Changed the welcome line").first();
    await entry.waitFor({ timeout: 120000 });
    await entry.click();
    await page.page.waitForTimeout(600);
    check("Change history lists the Brand save, opened", await page.page.getByText("Welcome line").first().isVisible());
    await page.page.screenshot({ path: shot("02-change-history-brand.png") });
    await page.context.close();
  } finally {
    await browser.close();
  }
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => console.log(`Passed ${passed} | Failed ${failed} | Skipped 0`));
