// B-291: the import's Changes page while it loads, next to the loaded page, dark 1440×900, through the shell.
// Uses the open review prepared by journey-b246-first-start.cjs (a re-import, so its review is the Changes page);
// holds the import's response to show loading, then lets it through. Changes no application data.
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("../../../Frontend/node_modules/playwright");
const { BASE, PASSWORD } = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");
async function main() {
  const fixture = JSON.parse(await fs.readFile(path.join(__dirname, "b246.local.json"), "utf8"));
  const out = path.join(__dirname, "../plans/B-291-screens");
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

    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await page.route(`**/api/corehr/imports/${fixture.session}`, async (route) => { await held; await route.continue(); });
    await page.goto(`${BASE}/core/import/${fixture.session}?step=changes`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await page.getByRole("status", { name: "Loading the import" }).waitFor({ timeout: 180000 });
    await page.getByText("Changes", { exact: true }).first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    const loading = await page.screenshot();
    release();
    await page.getByRole("region", { name: "Amira Khelifi has two start dates" }).waitFor({ timeout: 180000 });
    await page.evaluate(() => document.fonts.ready);
    const loaded = await page.screenshot();

    const side = await context.newPage();
    await side.setViewportSize({ width: 2896, height: 900 });
    const img = (buffer) => `<img src="data:image/png;base64,${buffer.toString("base64")}" width="1440" height="900">`;
    await side.setContent(`<body style="margin:0;background:#000;display:flex;gap:16px">${img(loading)}${img(loaded)}</body>`);
    await side.screenshot({ path: path.join(out, "01-loading-and-loaded.png") });
    console.log("B-291 capture | Passed 1 | Failed 0 | Skipped 0");
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error.message); console.error("B-291 capture | Passed 0 | Failed 1 | Skipped 0"); process.exitCode = 1; });
