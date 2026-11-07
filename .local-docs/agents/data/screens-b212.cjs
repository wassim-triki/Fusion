// B-212: the role page with "their unit", dark 1440x900, through the shell, as Amira Khelifi (administrator). Creates
// the example role "Product leads" (chosen: Mariam Gharbi) from the drawing, takes one screen with the Jobs reach menu
// open, then deletes the role again.
// Run: node .local-docs/agents/data/screens-b212.cjs   (stack up; FUSION_LOCAL_PASSWORD set)
const path = require("path"); const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const { BASE, PASSWORD, call, login } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));
const out = path.join(__dirname, "../plans/B-212-screens"); fs.mkdirSync(out, { recursive: true });
const claims = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());

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
  const amira = await login("amira.khelifi@example.test");
  const mariam = claims(await login("mariam.gharbi@example.test"));
  const mariamUser = Object.entries(mariam).find(([k]) => k.endsWith("nameidentifier"))?.[1] ?? mariam.sub;
  const overview = (await call("GET", "/api/identity/core-access/roles", null, amira)).json.data;
  for (const old of overview.roles.filter((r) => r.name === "Product leads")) await call("DELETE", `/api/identity/core-access/roles/${old.id}`, null, amira);
  const role = (await call("POST", "/api/identity/core-access/roles", { name: "Product leads" }, amira)).json.data.role;
  const picks = { job: "see", personal: "see", org: "see", approve: "propose", reports: "build", plans: "see" };
  const cells = overview.areas.filter((a) => !a.administratorsOnly).map((a) => ({
    areaId: a.id, level: picks[a.id] ?? "none", reach: picks[a.id] ? (a.id === "org" ? null : "unit") : null }));
  const saved = await fetch(`${BASE}/api/identity/core-access/roles/${role.id}`, { method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${amira}`, "If-Match": `"${role.version}"` },
    body: JSON.stringify({ name: "Product leads", description: null, cells, holderKind: "chosen", conditions: [], chosenUserIds: [mariamUser] }) });
  if (saved.status !== 200) throw new Error(`save ${saved.status} ${await saved.text()}`);

  const browser = await chromium.launch();
  try {
    const { page } = await session(browser, "amira.khelifi@example.test");
    await page.goto(`${BASE}/core/settings/roles/${role.id}`, { waitUntil: "domcontentloaded", timeout: 240000 });
    const reach = page.getByRole("button", { name: "Whose jobs and history" });
    await reach.waitFor({ timeout: 240000 });
    await page.getByText("Mariam's unit").waitFor({ timeout: 120000 });
    await page.waitForTimeout(1500);
    await reach.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(out, "01-role-their-unit.png") });
    console.log("Saved 01-role-their-unit.png");
  } finally {
    await browser.close();
    await call("DELETE", `/api/identity/core-access/roles/${role.id}`, null, amira);
  }
})().catch((error) => { console.error(error); process.exit(1); });
