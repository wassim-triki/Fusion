// B-191: the three agreed single sign-on screens, dark 1440×900, through the shell. Uses the company made by
// journey-b191-sso.cjs (b191.local.json): invites one more fictional person (for the invitation screen) and turns the
// requirement on (for the Settings screen, after signing in through it), and leaves it on. Changes nothing else.
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("../../../Frontend/node_modules/playwright");
const { BASE, PASSWORD, call, login, inviteToken } = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");

const data = (response) => response.json?.data;

/** A cookie-keeping round trip to the test provider, as the journey does it. */
async function testAs(token, email) {
  const jar = new Map();
  const send = async (method, url, { body, form, bearer } = {}) => {
    const headers = { Accept: "application/json" };
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    let payload;
    if (form) { headers["Content-Type"] = "application/x-www-form-urlencoded"; payload = new URLSearchParams(form).toString(); }
    else if (body) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
    const response = await fetch(url.startsWith("http") ? url : `${BASE}${url}`, { method, headers, body: payload, redirect: "manual" });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const [name, ...value] = pair.split("=");
      jar.set(name.trim(), value.join("="));
    }
    return { status: response.status, json: await response.json().catch(() => null), location: response.headers.get("location") };
  };
  const started = await send("POST", "/api/identity/sso/flows", { body: { purpose: "test", provider: "company" }, bearer: token });
  const authorize = new URL(started.json.data.authorizeUrl);
  const form = { ...Object.fromEntries(authorize.searchParams), email, email_verified: "true" };
  const atProvider = await send("POST", authorize.pathname, { form });
  const back = new URL(atProvider.location);
  await send("GET", back.pathname + back.search);
}

async function main() {
  const fixture = JSON.parse(await fs.readFile(path.join(__dirname, "b191.local.json"), "utf8"));
  const out = path.join(__dirname, "../plans/B-191-screens");
  await fs.mkdir(out, { recursive: true });
  let adminToken = await login(fixture.admin);

  // A fresh invitation for the invitation screen.
  const me = data(await call("GET", "/api/corehr/workforce/me", null, adminToken)).employee;
  const jobs = data(await call("GET", "/api/corehr/catalog/jobs", null, adminToken));
  const email = `hana.mansouri.${Date.now().toString(36)}@${fixture.domain}`;
  await call("POST", "/api/corehr/employees/hire", {
    firstName: "Hana", lastName: "Mansouri", workEmail: email, employeeNumberMode: "Generated",
    startDate: `${new Date().toISOString().slice(0, 10)}T00:00:00Z`, orgUnitId: me.orgUnit.orgUnitId,
    jobId: jobs.find((job) => !job.isRetired)?.id, primaryManagerEmployeeId: me.employeeId,
  }, adminToken);
  adminToken = await login(fixture.admin);
  const person = data(await call("GET", `/api/corehr/employees/people?q=${encodeURIComponent(email)}`, null, adminToken)).items.find((p) => p.workEmail === email);
  await call("POST", "/api/corehr/employees/people/invitations", { audience: "Chosen", employeeIds: [person.employeeId] }, adminToken);
  const invitation = await inviteToken(email);

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
    await context.addInitScript(() => localStorage.setItem("theme", "dark"));
    const page = await context.newPage();
    const settle = async () => { await page.evaluate(() => document.fonts.ready); await page.mouse.move(0, 0); await page.waitForTimeout(300); };

    // 1. Sign-in step 2 for a person at the company's domain: its provider leads, then Microsoft, Google, the password.
    await page.goto(`${BASE}/auth/signin?company=${encodeURIComponent(fixture.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await page.locator("#email").waitFor({ timeout: 180000 });
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.fill("#email", fixture.aicha);
      await page.waitForTimeout(400);
      if (await page.inputValue("#email") === fixture.aicha) break;
    }
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: /Continue with SSO Journey Login/ }).waitFor({ timeout: 60000 });
    await settle();
    await page.screenshot({ path: path.join(out, "01-sign-in-company-provider.png") });

    // 2. The invitation: the company's provider, Microsoft and Google above "or create a password".
    await page.goto(`${BASE}/invite/accept?token=${encodeURIComponent(invitation.token)}`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await page.getByRole("button", { name: /Continue with SSO Journey Login/ }).waitFor({ timeout: 180000 });
    await settle();
    await page.screenshot({ path: path.join(out, "02-invitation-providers.png") });

    // 3. Settings › Sign-in, connected and required, as the administrator (who signs in through it first).
    adminToken = await login(fixture.admin);
    await testAs(adminToken, fixture.admin);
    const on = await call("POST", "/api/identity/sso/settings/requirement", { on: true }, adminToken);
    if (on.status !== 200) throw new Error(`Requirement: ${on.status} ${JSON.stringify(on.json)}`);
    await page.goto(`${BASE}/auth/signin`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await page.locator("#email").waitFor({ timeout: 180000 });
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.fill("#email", fixture.admin);
      await page.waitForTimeout(400);
      if (await page.inputValue("#email") === fixture.admin) break;
    }
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    // Required now: the password sits behind "Use your password", for administrators.
    await page.getByRole("button", { name: "Use your password" }).click({ timeout: 60000 });
    await page.locator("#password").waitFor({ timeout: 60000 });
    await page.fill("#password", PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 180000 });
    await page.goto(`${BASE}/core/settings/sign-in`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await page.getByText(/password sessions? ended/).waitFor({ timeout: 180000 });
    await settle();
    await page.screenshot({ path: path.join(out, "03-settings-required.png"), fullPage: true });
    console.log("B-191 capture | Passed 3 | Failed 0 | Skipped 0");
  } finally {
    await browser.close();
  }
}
main().catch((error) => { console.error(error.stack ?? error.message); console.error("B-191 capture | Passed 0 | Failed 1 | Skipped 0"); process.exitCode = 1; });
