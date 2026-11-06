// B-192: one walk per role through the shell on Carthage, dark 1440×900: sign-in, Home, the role's main pages,
// a refused address, no colleague modules in the switcher, direct addresses to them turned back, public ones open.
// Screens into plans/B-192-screens/: the shared refusal and the front page's level word. Changes no application data.
// Needs the stack with Learning: stack.ps1 -AllApps. Lighter: pass first names and --no-learning, e.g. `node walk-b192-roles.cjs rim mariam leila --no-learning`,
// on stack.ps1 -Apps core,performance; the Learning address checks then count as skipped.
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("../../../Frontend/node_modules/playwright");
const { BASE, PASSWORD } = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");

const REFUSAL = "You don't have access to this page. Ask your administrator if you need it.";
const COLLEAGUE = ["Learning", "Recruitment", "Interview", "Onboarding"];
const ROLES = [
  { who: "Amira Khelifi, the administrator", email: "amira.khelifi@example.test", pages: ["/core", "/core/people", "/core/organization", "/core/reports", "/core/settings", "/performance", "/performance/cycle"] },
  { who: "Rim Mahjoub, HR partner", email: "rim.mahjoub@example.test", pages: ["/core/profile", "/performance"], refused: "/performance/cycle" },
  { who: "Mariam Gharbi, a manager", email: "mariam.gharbi@example.test", pages: ["/core/team", "/core/profile", "/performance", "/performance/team"], refused: "/performance/cycle" },
  { who: "Leila Baccouche, an employee", email: "leila.baccouche@example.test", pages: ["/core/profile", "/performance", "/performance/plan"], refused: "/performance/cycle", screen: "01-refusal.png" },
];

const args = process.argv.slice(2);
const withLearning = !args.includes("--no-learning");
const names = args.filter((arg) => !arg.startsWith("--"));
const chosen = names.length ? ROLES.filter((role) => names.some((name) => role.email.startsWith(`${name}.`))) : ROLES;

let skipped = 0;
let passed = 0;
let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ` | ${detail}` : ""}`);
};

async function signIn(page, email) {
  await page.goto(`${BASE}/auth/signin`, { waitUntil: "networkidle", timeout: 180000 });
  const address = page.locator("#email");
  const password = page.locator("#password");
  // Email-first sign-in; a re-render during hydration can clear the address, so type it again until the step moves on.
  for (let attempt = 0; attempt < 6 && !(await password.isVisible()); attempt += 1) {
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

/** The page settled: no server failure page, and nothing still saying it is opening. */
async function opens(page, url) {
  const response = await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  const text = await page.locator("body").innerText();
  return { status: response?.status() ?? 0, text, at: new URL(page.url()).pathname };
}

async function main() {
  const out = path.join(__dirname, "../plans/B-192-screens");
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const role of chosen) {
      console.log(`\n${role.who}`);
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
      await context.addInitScript(() => localStorage.setItem("theme", "dark"));
      const page = await context.newPage();
      await signIn(page, role.email);
      check("signs in", true);

      const home = await opens(page, "/");
      check("Home opens", home.status < 400 && home.at === "/", `${home.status} at ${home.at}`);

      for (const url of role.pages) {
        const result = await opens(page, url);
        check(`${url} opens`, result.status < 400 && !result.text.includes(REFUSAL), `${result.status}, at ${result.at}`);
        if (url === "/core" && role.email.startsWith("amira")) {
          check("front page says the company's own word", /\bdivisions?\b/i.test(result.text) && !/\bdepartments\b/i.test(result.text));
          await page.evaluate(() => document.fonts.ready);
          await page.screenshot({ path: path.join(out, "02-front-page-level-word.png") });
        }
      }

      if (role.refused) {
        const result = await opens(page, role.refused);
        check(`${role.refused} refuses with the one line`, result.text.includes(REFUSAL), result.text.slice(0, 160));
        if (role.screen) {
          await page.evaluate(() => document.fonts.ready);
          await page.screenshot({ path: path.join(out, role.screen) });
        }
      }

      // The switcher lives in a module's sidebar; a closed menu proves nothing, so it must show Performance first.
      await opens(page, role.pages[0]);
      await page.getByRole("button", { name: /Core HR/ }).first().click();
      const menu = page.getByRole("menu");
      await menu.waitFor({ timeout: 15000 });
      const offered = await menu.innerText();
      check("switcher opens with Performance", offered.includes("Performance"), offered);
      for (const name of COLLEAGUE) check(`switcher has no ${name}`, !offered.includes(name), offered);
      await page.keyboard.press("Escape");

      if (withLearning) {
        const typed = await opens(page, "/learning");
        await page.waitForURL((url) => !url.pathname.startsWith("/learning"), { timeout: 60000 }).catch(() => {});
        check("/learning goes Home", new URL(page.url()).pathname === "/", `at ${new URL(page.url()).pathname}, status ${typed.status}`);

        const verify = await opens(page, "/learning/verify/B192-NOT-A-CERTIFICATE");
        await page.waitForTimeout(1500);
        check("/learning/verify stays open", new URL(page.url()).pathname.startsWith("/learning/verify"), `at ${new URL(page.url()).pathname}, status ${verify.status}`);
      } else {
        skipped += 2;
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`\nB-192 walk | Passed ${passed} | Failed ${failed} | Skipped ${skipped}`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  console.error(`B-192 walk | Passed ${passed} | Failed ${failed + 1} | Skipped ${skipped}`);
  process.exit(1);
});
