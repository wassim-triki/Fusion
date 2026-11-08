// B-320 session 1 (B-198): Feedback with its tabs as address tabs, dark 1440x900, through the shell, as Mariam Gharbi
// (manager, so the Your team tab shows). Changes no data.
// Run: node .local-docs/agents/data/screens-b320-feedback.cjs   (stack up; FUSION_LOCAL_PASSWORD set)
const path = require("path"); const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const { BASE, PASSWORD, call } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));
const out = path.join(__dirname, "../plans/B-320-screens"); fs.mkdirSync(out, { recursive: true });

async function session(browser, email) {
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
    const { page } = await session(browser, "mariam.gharbi@example.test");
    await page.goto(`${BASE}/performance/feedback?tab=requests`, { waitUntil: "domcontentloaded", timeout: 300000 });
    await page.getByRole("link", { name: /^Requests/ }).waitFor({ timeout: 300000 });
    await page.getByRole("link", { name: /^Your team/ }).waitFor({ timeout: 120000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(out, "01-feedback-tabs.png") });
    console.log("Saved 01-feedback-tabs.png");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
