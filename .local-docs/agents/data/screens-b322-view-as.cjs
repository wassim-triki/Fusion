// Screen for B-322 session 2 (B-220), dark 1440x900, through the shell:
//   node .local-docs/agents/data/screens-b322-view-as.cjs
// Amira Khelifi, the administrator, sees Fusion as Mariam Gharbi (manager) and opens Aicha Bouazizi, Mariam's report:
// "Propose a change" stays, greyed, with the reason on focus. Starting the view is recorded in Change history; it ends
// on its own after 30 minutes. Changes no other data.
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const { BASE, PASSWORD, call } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const shot = (name) => {
  const dir = path.join(__dirname, "../plans/B-322-screens");
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
const stored = (d, viewAs) => ({ accessToken: d.accessToken, refreshToken: d.refreshToken, accessTokenExpiration: d.accessTokenExpiration,
  ...(viewAs ? { viewAs } : {}),
  user: { userId: d.userId, tenantId: d.tenantId ?? null, tenantMembershipId: d.tenantMembershipId ?? null,
    moduleEntitlements: d.moduleEntitlements ?? [], email: d.email, fullName: d.fullName, roles: d.roles,
    employeeId: d.employeeId ?? null, language: d.language, accessProfiles: d.accessProfiles ?? [], effectivePermissions: d.effectivePermissions ?? [] } });

(async () => {
  const login = await call("POST", "/api/identity/auth/login", { email: "amira.khelifi@example.test", password: PASSWORD });
  const amira = login.json.data;
  const roles = (await call("GET", "/api/identity/core-access/roles", null, amira.accessToken)).json.data.roles;
  const everyone = roles.find((role) => role.holderKind === "everyone" && !role.isAdministrators);
  const holders = (await call("GET", `/api/identity/core-access/roles/${everyone.id}`, null, amira.accessToken)).json.data.holders;
  const mariam = holders.find((holder) => holder.name === "Mariam Gharbi");
  const people = (await call("GET", "/api/corehr/reports/front-page", null, amira.accessToken)).json.data.people;
  const aicha = people.find((person) => person.name === "Aicha Bouazizi");

  const started = await call("POST", "/api/identity/view-as", { userId: mariam.userId }, amira.accessToken);
  check("Amira sees Fusion as Mariam", started.status === 200);
  const view = started.json.data;
  const marker = { sessionId: view.sessionId, viewerName: view.viewerName, personName: view.personName,
    roles: view.roles.map((role) => (role.isAdministrators ? "@administrators" : role.name)), returnTo: "/core/settings/roles", expiresAt: view.expiresAt };

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
    await context.addCookies([{ name: "ey_hr_authenticated", value: "true", url: BASE }, { name: "NEXT_LOCALE", value: "en", url: BASE }]);
    await context.addInitScript(({ home, auth }) => {
      localStorage.setItem("theme", "dark");
      localStorage.setItem("ey_hr_auth_home", JSON.stringify(home));
      localStorage.setItem("ey_hr_auth", JSON.stringify(auth));
    }, { home: stored(amira), auth: stored(view.session, marker) });
    const page = await context.newPage();
    await page.goto(`${BASE}/core/people/${aicha.employeeKey}`, { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByText("Seeing Fusion as Mariam Gharbi").waitFor({ timeout: 240000 });
    const propose = page.getByRole("button", { name: /Propose a change/ });
    await propose.waitFor({ timeout: 120000 });
    await page.waitForFunction(() => document.querySelectorAll("[data-slot=skeleton]").length === 0, null, { timeout: 120000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    check("Propose a change stays, greyed", await propose.isDisabled());
    await propose.locator("xpath=..").focus();
    await page.getByRole("tooltip").waitFor({ timeout: 10000 });
    check("and says why", (await page.getByRole("tooltip").innerText()).includes("You're seeing Fusion as Mariam Gharbi"));
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot("03-view-as-inert-change.png") });
    await context.close();
  } finally {
    await browser.close();
  }
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => console.log(`Passed ${passed} | Failed ${failed} | Skipped 0`));
