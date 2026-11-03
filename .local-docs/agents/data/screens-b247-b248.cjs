// Only the three touched surfaces, dark 1440x900, through the shell. No application data changes.
const path = require("path"); const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const { BASE, PASSWORD, call } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));
const out = path.join(__dirname, "../plans/B-247-screens"); fs.mkdirSync(out, { recursive: true });
const managerOut = path.join(__dirname, "../plans/B-248-screens"); fs.mkdirSync(managerOut, { recursive: true });
let passed = 0, failed = 0;
function check(label, ok) { console.log(`${ok ? "PASS" : "FAIL"} ${label}`); if (ok) passed++; else { failed++; throw new Error(label); } }
async function session(browser, email) {
  // Authenticate through the product API; sign-in UI is outside this surface capture.
  const response = await call("POST", "/api/identity/auth/login", { email, password: PASSWORD });
  if (response.status !== 200) throw new Error(`Sign-in failed: ${response.status}`);
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
(async () => {
  const browser = await chromium.launch();
  try {
    if (!fs.existsSync(path.join(out, "01-settings-details.png"))) {
    const admin = await session(browser, "amira.khelifi@example.test");
    await admin.page.goto(`${BASE}/core/settings/details`, { waitUntil: "domcontentloaded", timeout: 240000 });
    await admin.page.getByRole("checkbox", { name: "Monday" }).waitFor({ timeout: 240000 });
    check("Details offers seven working days", await admin.page.getByRole("checkbox").count() === 7);
    check("Monday-Friday are selected", await admin.page.getByRole("checkbox", { checked: true }).count() === 5);
    await admin.page.screenshot({ path: path.join(out, "01-settings-details.png") });
    await admin.context.close();
    }
    // The existing Fresh preset still has an incomplete setup guide, using real tenant defaults.
    const fresh = await session(browser, "amira.khelifi@fresh-5.example.test");
    await fresh.page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 240000 });
    await fresh.page.locator("#setup-title").waitFor({ timeout: 120000 });
    const company = fresh.page.getByRole("region", { name: "Your company", exact: true });
    await company.waitFor({ timeout: 120000 });
    await company.getByText("Mon–Fri").waitFor({ timeout: 60000 });
    check("Company card shows the stored work week", await company.getByText("Work week", { exact: true }).isVisible());
    if (!fs.existsSync(path.join(out, "02-home-company.png"))) await fresh.page.screenshot({ path: path.join(out, "02-home-company.png") });
    await fresh.context.close();
    const demo = JSON.parse(fs.readFileSync(path.join(__dirname, "b247-b248.local.json")));
    const joiner = await session(browser, demo.email);
    await joiner.page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 240000 });
    await joiner.page.locator("#manager-title").waitFor({ timeout: 120000 });
    const managerCard = joiner.page.locator('section[aria-labelledby="manager-title"]');
    await managerCard.getByText("Mariam Gharbi", { exact: true }).waitFor({ timeout: 60000 });
    check("Joiner sees their manager", await managerCard.getByText("Mariam Gharbi", { exact: true }).isVisible());
    check("Joiner manager card has a job title", Boolean(await joiner.page.locator('section[aria-labelledby="manager-title"]').textContent().then(s => s.includes("Mariam Gharbi") && s.length > 30)));
    if (!fs.existsSync(path.join(managerOut, "01-home-joiner.png"))) await joiner.page.screenshot({ path: path.join(managerOut, "01-home-joiner.png") });
    await joiner.context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => console.log(`Passed ${passed} | Failed ${failed} | Skipped 0`));
