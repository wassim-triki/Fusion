// B-211: the top bar search, dark 1440x900, through the shell, as Mariam Gharbi (a manager). No application data changes.
// Run: node .local-docs/agents/data/screens-b211.cjs [query]   (stack up; FUSION_LOCAL_PASSWORD set)
const path = require("path"); const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const { BASE, PASSWORD, call } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));
const out = path.join(__dirname, "../plans/B-211-screens"); fs.mkdirSync(out, { recursive: true });
const query = process.argv[2] ?? "product";

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
    const { context, page } = await session(browser, "mariam.gharbi@example.test");
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 240000 });
    const field = page.getByRole("combobox", { name: "Search" });
    await field.waitFor({ timeout: 240000 });
    await page.waitForTimeout(1500);
    await field.click();
    await field.pressSequentially(query, { delay: 60 });
    await page.getByRole("group", { name: "People" }).waitFor({ timeout: 60000 });
    await page.waitForTimeout(800);
    await field.press("ArrowRight");
    await field.press("ArrowRight");
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, "01-search.png") });
    console.log("Saved 01-search.png");
    await context.close();
  } finally { await browser.close(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
