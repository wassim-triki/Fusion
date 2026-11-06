// B-302 screens through the shell, dark, 1440x900, as Leila Baccouche, an employee of Carthage, into plans/B-302-screens/.
// Changes no application data. Failures are honest: a page she can't open, a wrong address, a session whose refresh token
// this browser spoils. `down` needs CoreHR and Performance stopped first (stack.ps1 -Down -Only <Service>) and takes Core HR
// not responding plus Home with its pieces failed.
// Run: node screens-b302-error-pages.cjs [up|down]    (default up)
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../../../Frontend/node_modules/playwright");
const { BASE, PASSWORD } = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");

const OUT = path.join(__dirname, "..", "plans", "B-302-screens");
fs.mkdirSync(OUT, { recursive: true });
const mode = process.argv[2] ?? "up";

async function signIn(page, email) {
  await page.goto(`${BASE}/auth/signin`, { waitUntil: "domcontentloaded", timeout: 240000 });
  const address = page.locator("#email");
  const password = page.locator("#password");
  for (let i = 0; i < 6 && !(await password.isVisible()); i += 1) {
    if (await address.isVisible()) {
      await address.fill(email);
      await page.locator('button[type="submit"]').click();
    }
    await password.waitFor({ timeout: 20000 }).catch(() => {});
  }
  await password.fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 240000 });
}

async function open(page, address, wait) {
  await page.goto(`${BASE}${address}`, { waitUntil: "domcontentloaded", timeout: 240000 });
  await page.getByText(wait).first().waitFor({ timeout: 240000 });
  await page.waitForTimeout(4200); // lets the drawing's movement finish
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log("saved", name);
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await context.addInitScript(() => { try { window.localStorage.setItem("theme", "dark"); } catch {} });
  const page = await context.newPage();
  await signIn(page, "leila.baccouche@example.test");

  if (mode === "down") {
    await open(page, "/core/profile", "isn't responding");
    await shot(page, "module-down");
    await open(page, "/", /did(n't| not) load/);
    await page.waitForTimeout(6000);
    await shot(page, "part-of-a-page");
  } else {
    await open(page, "/core/access", "You don't have access to this page");
    await page.getByText("can give you access").first().waitFor({ timeout: 60000 });
    await shot(page, "refusal");
    await open(page, "/core/no-such-page", "We can't find this page");
    await shot(page, "not-found");
    await page.waitForTimeout(10000); // hydration, on a loaded dev server
    await page.getByRole("button", { name: /Search for a page/ }).click();
    await page.getByRole("dialog").waitFor({ timeout: 20000 });
    console.log("search opens: yes");
    await page.keyboard.press("Escape");

    // Arabic, right to left, once.
    const arabic = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
    await arabic.addInitScript(() => { try { window.localStorage.setItem("theme", "dark"); } catch {} });
    await arabic.addCookies([{ name: "NEXT_LOCALE", value: "ar", url: BASE }]);
    const rtl = await arabic.newPage();
    await signIn(rtl, "leila.baccouche@example.test");
    await rtl.context().addCookies([{ name: "NEXT_LOCALE", value: "ar", url: BASE }]);
    await open(rtl, "/core/access", "ليس لديك صلاحية");
    console.log("dir:", await rtl.locator("html").getAttribute("dir"));
    await shot(rtl, "refusal-arabic");
    await arabic.close();

    // A session that can't be renewed: the access token has run out and the refresh token no longer works.
    await page.goto(`${BASE}/core/people`, { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem("ey_hr_auth"));
      stored.accessTokenExpiration = new Date(Date.now() - 60000).toISOString();
      stored.refreshToken = "no-longer-valid";
      localStorage.setItem("ey_hr_auth", JSON.stringify(stored));
    });
    await page.goto(`${BASE}/core/people`, { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByText("You've been signed out").waitFor({ timeout: 240000 });
    await page.waitForTimeout(4200);
    console.log("signed out at:", new URL(page.url()).pathname + new URL(page.url()).search);
    await shot(page, "signed-out");

  }
  await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });
