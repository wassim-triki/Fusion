// B-229 (B-313 session 2): Aicha Bouazizi on leave now, and her page as Amira Khelifi (HR), dark 1440x900, through the shell:
//   node .local-docs/agents/data/screens-b229-leave.cjs
// 1. As Amira, makes sure Aicha is on Annual leave from today to the Friday of next week (re-runnable: an existing
//    leave of hers is left as it is).
// 2. Screens Aicha's Overview: the pill, the photo mark, the glance cell and Coming up with Change and Cancel leave (End early from its second day).
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const { BASE, PASSWORD, call } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const shotPath = (name) => {
  const dir = path.join(__dirname, "../plans/B-229-screens");
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
const iso = (date) => date.toISOString().slice(0, 10);

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

(async () => {
  const browser = await chromium.launch();
  try {
    const hr = await session(browser, "amira.khelifi@example.test");
    const people = (await call("GET", "/api/corehr/reports/front-page", null, hr.token)).json.data.people;
    const aicha = people.find((p) => p.name === "Aicha Bouazizi");
    const profile = (await call("GET", `/api/corehr/employees/people/${aicha.employeeKey}`, null, hr.token)).json.data;
    if (!profile.leave) {
      const lists = (await call("GET", "/api/corehr/catalog/lists", null, hr.token)).json.data;
      const annual = lists.find((list) => list.id === "leave-types").values.find((value) => value.label === "Annual leave");
      const today = new Date();
      const friday = new Date(today);
      friday.setUTCDate(today.getUTCDate() + ((5 - today.getUTCDay() + 7) % 7) + 7);
      const set = await call("POST", `/api/corehr/changes/people/${aicha.employeeKey}/propose`,
        { leave: { leaveTypeId: annual.id, from: iso(today), until: iso(friday) } }, hr.token);
      check(`Amira sets Aicha's leave (${set.status})`, set.status === 200 && Boolean(set.json.data.change));
    }
    const now = (await call("GET", `/api/corehr/employees/people/${aicha.employeeKey}`, null, hr.token)).json.data.leave;
    check("Aicha is on leave now, with its type for HR", Boolean(now?.now) && now.type === "Annual leave");

    await hr.page.goto(`${BASE}/core/people/${aicha.employeeKey}`, { waitUntil: "domcontentloaded", timeout: 240000 });
    await hr.page.getByRole("heading", { name: "Coming up" }).waitFor({ timeout: 240000 });
    await hr.page.getByRole("button", { name: /^(End early|Change)$/ }).first().waitFor({ timeout: 60000 });
    await hr.page.waitForTimeout(1200);
    check("the band says she is on leave", await hr.page.getByText("On leave", { exact: true }).first().isVisible());
    await hr.page.screenshot({ path: shotPath("aicha-on-leave.png") });
    await hr.context.close();
  } finally {
    await browser.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
