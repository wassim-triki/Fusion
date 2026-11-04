// One touched surface: the first person's dated import choice, dark 1440×900, through the shell.
// Uses the open review prepared by journey-b246-first-start.cjs; changes no application data.
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("../../../Frontend/node_modules/playwright");
const { BASE, PASSWORD } = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");
async function main() {
  const fixture = JSON.parse(await fs.readFile(path.join(__dirname, "b246.local.json"), "utf8"));
  const out = path.join(__dirname, "../plans/B-246-screens");
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
    await context.addInitScript(() => localStorage.setItem("theme", "dark"));
    const page = await context.newPage();
    await page.goto(`${BASE}/auth/signin`, { waitUntil: "domcontentloaded", timeout: 180000 });
    const submit = page.locator('button[type="submit"]');
    await submit.waitFor({ timeout: 120000 });
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.fill("#email", fixture.admin);
      await page.fill("#password", PASSWORD);
      await page.waitForTimeout(400);
      if (await page.inputValue("#email") === fixture.admin) break;
    }
    await submit.click();
    await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 180000 });
    await page.goto(`${BASE}/core/import/${fixture.session}?step=chart`, { waitUntil: "domcontentloaded", timeout: 180000 });
    const offer = page.getByRole("region", { name: "Amira Khelifi has two start dates" });
    // A named section is a region. Wait for both choices and the changed row before capturing.
    await offer.waitFor({ timeout: 180000 });
    await page.getByRole("radio", { name: /Use .*2020/ }).waitFor();
    await page.getByText("Start date", { exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: path.join(out, "01-first-person-start.png") });
    console.log("B-246 capture | Passed 1 | Failed 0 | Skipped 0");
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error.message); console.error("B-246 capture | Passed 0 | Failed 1 | Skipped 0"); process.exitCode = 1; });
