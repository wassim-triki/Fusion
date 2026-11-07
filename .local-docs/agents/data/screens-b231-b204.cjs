// Screens for B-313 session 1, dark 1440x900, through the shell:
//   node .local-docs/agents/data/screens-b231-b204.cjs   (run journey-b231-b204.cjs first: it sends the praise email)
// 1. B-231: Aicha Bouazizi's Access tab as Amira Khelifi (HR), History in view.
// 2. B-204: the newest Performance email to Aicha in Mailpit, as a mail client shows it.
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const { BASE, MAILPIT, PASSWORD, call } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

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
  return { context, page: await context.newPage(), token: d.accessToken };
}

(async () => {
  const browser = await chromium.launch();
  try {
    const hr = await session(browser, "amira.khelifi@example.test");
    const people = (await call("GET", "/api/corehr/reports/front-page", null, hr.token)).json.data.people;
    const aicha = people.find((p) => p.name === "Aicha Bouazizi");
    await hr.page.goto(`${BASE}/core/people/${aicha.employeeKey}?tab=access`, { waitUntil: "domcontentloaded", timeout: 240000 });
    const heading = hr.page.getByRole("heading", { name: "History" });
    await heading.waitFor({ timeout: 240000 });
    await hr.page.getByText("Accepted the invitation").waitFor({ timeout: 60000 });
    await heading.scrollIntoViewIfNeeded();
    await heading.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await hr.page.waitForTimeout(800);
    check("History tells Aicha's story", await hr.page.getByText("Invited by Amira Khelifi").isVisible());
    await hr.page.screenshot({ path: shot("B-231", "access-history.png") });
    await hr.context.close();

    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=to:aicha.bouazizi@example.test`)).json();
    const mail = list.messages.find((m) => /fusion-performance/.test(m.MessageID));
    check("a Performance email to Aicha exists", Boolean(mail));
    const viewer = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
    const page = await viewer.newPage();
    await page.goto(`${MAILPIT}/view/${mail.ID}.html`, { waitUntil: "load" });
    await page.waitForTimeout(500);
    check("it shows Carthage's sign-off", await page.getByText(/Sent by Carthage .* with Fusion/).isVisible());
    await page.screenshot({ path: shot("B-204", "branded-email.png") });
    await viewer.close();
  } finally {
    await browser.close();
  }
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => console.log(`Passed ${passed} | Failed ${failed} | Skipped 0`));
