// B-302: does every link a role is offered open? Per role in Carthage: Home's and each module's sidebar links (read from the page),
// each opened and checked for the refusal line and server failures. Changes no application data.
// Needs: stack.ps1 -Apps core,performance. Run: node links-b302-sidebar.cjs [first names]
const { chromium } = require("../../../Frontend/node_modules/playwright");
const { BASE, PASSWORD } = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");

const REFUSAL = "You don't have access to this page";
const ROLES = [
  ["Amira Khelifi, the administrator", "amira.khelifi@example.test"],
  ["Rim Mahjoub, HR partner", "rim.mahjoub@example.test"],
  ["Mariam Gharbi, a manager", "mariam.gharbi@example.test"],
  ["Omar Mansour, a manager without team view", "omar.mansour@example.test"],
  ["Leila Baccouche, an employee", "leila.baccouche@example.test"],
];
const names = process.argv.slice(2);
const chosen = names.length ? ROLES.filter(([, email]) => names.some((n) => email.startsWith(`${n}.`))) : ROLES;
let passed = 0;
let failed = 0;

async function signIn(page, email) {
  await page.goto(`${BASE}/auth/signin`, { waitUntil: "networkidle", timeout: 180000 });
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
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 180000 });
}

const settle = async (page) => {
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(800);
};
const sidebarLinks = (page) =>
  page.locator("aside a[href], nav a[href], [data-sidebar] a[href]").evaluateAll((as) =>
    [...new Set(as.map((a) => new URL(a.href).pathname))].filter((p) => p.startsWith("/") && !p.startsWith("/auth")),
  );

(async () => {
  const browser = await chromium.launch();
  for (const [who, email] of chosen) {
    console.log(`\n${who}`);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
    const page = await context.newPage();
    await signIn(page, email);
    const seen = new Set();
    for (const start of ["/", "/core", "/performance"]) {
      const response = await page.goto(`${BASE}${start}`, { waitUntil: "domcontentloaded", timeout: 180000 });
      await settle(page);
      const text = await page.locator("body").innerText();
      if (text.includes(REFUSAL) || (response?.status() ?? 0) >= 400) {
        console.log(`note ${start} itself: status ${response?.status()}, refused ${text.includes(REFUSAL)}`);
      }
      for (const link of await sidebarLinks(page)) seen.add(link);
    }
    for (const link of [...seen].sort()) {
      const response = await page.goto(`${BASE}${link}`, { waitUntil: "domcontentloaded", timeout: 180000 });
      await settle(page);
      const text = await page.locator("body").innerText();
      const at = new URL(page.url()).pathname;
      const ok = (response?.status() ?? 0) < 400 && !text.includes(REFUSAL);
      if (ok) passed += 1;
      else failed += 1;
      const moved = at !== link ? ` -> ${at}` : "";
      console.log(`${ok ? "ok  " : "FAIL"} ${link}${moved}${ok ? "" : ` | ${response?.status()}, refused ${text.includes(REFUSAL)}`}`);
    }
    await context.close();
  }
  await browser.close();
  console.log(`\nB-302 links | Passed ${passed} | Failed ${failed} | Skipped 0`);
  process.exitCode = failed ? 1 : 0;
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
