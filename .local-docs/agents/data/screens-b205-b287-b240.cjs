// Screens for the B-205/B-287/B-240 batch, dark 1440x900, through the shell:
//   node .local-docs/agents/data/screens-b205-b287-b240.cjs
// 1. B-205: Yasmine Trabelsi (Carthage joiner, B-184) invited by Amira (HR) through the invite sheet's endpoint; her
//    mail's link opened signed out (it names the company, so the page wears Carthage's brand). Leaves her invitation
//    pending, so the page can be tried by hand from Mailpit.
// 2. B-287: Core HR's front page as Amira, Open roles in view (run seed-b287-filled-role.cjs first).
// 3. B-240: the People directory's cards as Aicha Bouazizi (employee).
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const { BASE, MAILPIT, PASSWORD, call, login } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const plans = path.join(__dirname, "../plans");
const shot = (item, name) => {
  const dir = path.join(plans, `${item}-screens`);
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
  return { context, page: await context.newPage() };
}

/** The newest invitation link in Mailpit for this address, whole (with its company). */
async function invitationLink(email) {
  for (let i = 0; i < 30; i++) {
    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=to:${encodeURIComponent(email)}`)).json();
    const message = list.messages?.[0];
    if (message) {
      const full = await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json();
      const found = full.Text.match(/https?:\/\/[^\s"'<>]*\/invite\/accept\?[^\s"'<>\])]+/);
      if (found) return found[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`no invitation mail for ${email}`);
}

(async () => {
  const browser = await chromium.launch();
  try {
    // 1. The invitation page (B-205).
    const amira = await login("amira.khelifi@example.test");
    const front = (await call("GET", "/api/corehr/reports/front-page", null, amira)).json.data;
    const yasmine = front.people.find((person) => person.name === "Yasmine Trabelsi");
    if (!yasmine) throw new Error("Yasmine Trabelsi isn't in Carthage; run seed-b184-joining-leaving.cjs first");
    const hex = yasmine.employeeKey.replace(/^E-/, "").toLowerCase();
    const employeeId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    const sent = await call("POST", "/api/corehr/employees/people/invitations", { audience: "Chosen", employeeIds: [employeeId] }, amira);
    check("Yasmine is invited", sent.status === 200);
    const link = await invitationLink("yasmine.trabelsi@example.test");
    check("the link names the company", /[?&]company=carthage/.test(link));
    console.log(`invitation: ${link}`);
    const guest = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
    await guest.addCookies([{ name: "NEXT_LOCALE", value: "en", url: BASE }]);
    const invite = await guest.newPage();
    await invite.goto(link.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: "domcontentloaded", timeout: 240000 });
    await invite.getByRole("heading", { level: 1, name: /Join / }).waitFor({ timeout: 240000 });
    await invite.getByRole("heading", { level: 2, name: "Carthage Digital Group" }).waitFor({ timeout: 60000 });
    await invite.waitForTimeout(800);
    check("the page wears Carthage's name", await invite.getByRole("heading", { level: 2, name: "Carthage Digital Group" }).isVisible());
    await invite.screenshot({ path: shot("B-205", "invitation.png") });
    await guest.close();

    // 2. A filled role on the front page (B-287).
    const hr = await session(browser, "amira.khelifi@example.test");
    await hr.page.goto(`${BASE}/core`, { waitUntil: "domcontentloaded", timeout: 240000 });
    const roles = hr.page.getByRole("heading", { name: "Open roles" });
    await roles.waitFor({ timeout: 240000 });
    await hr.page.getByText(/Ons Khemiri, /).first().waitFor({ timeout: 60000 });
    await roles.scrollIntoViewIfNeeded();
    await hr.page.evaluate(() => window.scrollBy(0, 260));
    await hr.page.waitForTimeout(600);
    check("the filled role names Ons Khemiri", await hr.page.getByText(/Ons Khemiri, /).first().isVisible());
    await hr.page.screenshot({ path: shot("B-287", "filled-role.png") });
    await hr.context.close();

    // 3. The directory card (B-240).
    const aicha = await session(browser, "aicha.bouazizi@example.test");
    await aicha.page.goto(`${BASE}/core/people`, { waitUntil: "domcontentloaded", timeout: 240000 });
    await aicha.page.locator("article").first().waitFor({ timeout: 240000 });
    await aicha.page.waitForTimeout(800);
    check("cards are drawn", (await aicha.page.locator("article").count()) > 4);
    await aicha.page.screenshot({ path: shot("B-240", "directory-card.png") });
    await aicha.context.close();
  } finally {
    await browser.close();
  }
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => console.log(`Passed ${passed} | Failed ${failed} | Skipped 0`));
