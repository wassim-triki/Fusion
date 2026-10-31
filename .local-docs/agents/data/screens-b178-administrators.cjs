#!/usr/bin/env node
/**
 * B-178 screens: Administrators and seeing Fusion as someone. Dark at 1440×900, through the shell, in Carthage ·
 * Mid-year (one administrator, Amira Khelifi) so the page opens at "1 of at least 2".
 *
 * Captures the roles table with one administrator, the Administrators page (one slot and the empty one), the add
 * sheet with Nour Ben Ali (Chief People and Operations Officer) picked and Amira's password typed, the page with two
 * administrators after adding her, Managers' role page with "See Fusion as …", Fusion seen as that manager (Home and
 * a person on their team, with the bar), and Change history with both recorded.
 *
 * CHANGES DATA: Nour Ben Ali becomes Mid-year's second administrator (a company can't go back below two). Skipped when
 * she already is; the one-administrator frames are then not retaken.
 *
 * Also frames the accepted drawing (explorer 3b, Roles › Administrators and Seeing as someone) at the same size, as
 * ref-*.png, for the side-by-side review.
 *
 * Usage: node .local-docs/agents/data/screens-b178-administrators.cjs
 * Writes PNGs to .local-docs/agents/plans/B-178-screens/<name>.png.
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const { call, login } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const BASE = "http://localhost:3000";
const PASSWORD = process.env.FUSION_LOCAL_PASSWORD;
const DOMAIN = "midyear-5.example.test";
const CHOOSE = "Choose who looks and whose page";
const OUT = path.join(__dirname, "..", "plans", "B-178-screens");
fs.mkdirSync(OUT, { recursive: true });

async function signIn(page, email) {
  await page.goto(`${BASE}/auth/signin`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  const submit = page.locator('button[type="submit"]');
  await submit.waitFor({ state: "visible", timeout: 120_000 });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.fill("#email", email);
    await page.fill("#password", PASSWORD);
    await page.waitForTimeout(500);
    if ((await page.inputValue("#email")) === email) break;
  }
  await submit.click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 120_000 });
}

async function shot(page, name) {
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ${name}.png`);
}

async function open(page, route, ready) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await ready.waitFor({ state: "visible", timeout: 240_000 });
  await page.waitForTimeout(2000);
}

(async () => {
  const amira = await login(`amira.khelifi@${DOMAIN}`);
  const roles = (await call("GET", "/api/identity/core-access/roles", null, amira)).json.data.roles;
  const managers = roles.find((role) => role.isBuiltIn && role.holderKind === "team");
  const admins = (await call("GET", "/api/identity/tenant-access/administrators", null, amira)).json.data;
  const first = admins.length < 2;
  const aicha = (await call("GET", "/api/corehr/employees/people?q=Aicha&pageSize=5", null, amira)).json.data.items[0];

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
    await context.addInitScript(() => { try { window.localStorage.setItem("theme", "dark"); } catch {} });
    const page = await context.newPage();
    await signIn(page, `amira.khelifi@${DOMAIN}`);

    if (first) {
      await open(page, "/core/settings/roles", page.getByRole("table"));
      await shot(page, "01-every-role-one-administrator");

      await open(page, "/core/settings/roles/administrators", page.getByRole("heading", { name: "History" }));
      await shot(page, "02-administrators-one");

      await page.getByRole("button", { name: "Add", exact: true }).click();
      await page.getByPlaceholder("Find a person").fill("Nour");
      await page.getByRole("radio", { name: /Nour Ben Ali/ }).waitFor({ timeout: 60_000 });
      await page.waitForTimeout(1500);
      await page.getByRole("radio", { name: /Nour Ben Ali/ }).click();
      await page.fill("#admin-password", PASSWORD);
      await shot(page, "03-add-sheet");

      await page.getByRole("button", { name: "Make Nour an administrator" }).click();
      await page.getByText("2 administrators").waitFor({ timeout: 60_000 });
      await page.waitForTimeout(1200);
      await shot(page, "04-administrators-two");
    } else {
      await open(page, "/core/settings/roles/administrators", page.getByRole("heading", { name: "History" }));
      await shot(page, "04-administrators-two");
    }

    // Managers' role page looking through Mariam Gharbi (a manager), then Fusion as her.
    await open(page, `/core/settings/roles/${managers.id}`, page.getByRole("button", { name: /See Fusion as/ }));
    await page.getByRole("button", { name: CHOOSE }).click();
    // "Who looks" lists the role's holders first; a search narrows it to one, which hides that group.
    await page.getByRole("option", { name: /Mariam Gharbi/ }).first().waitFor({ timeout: 60_000 });
    await page.getByRole("option", { name: /Mariam Gharbi/ }).first().click();
    await page.getByRole("button", { name: "See Fusion as Mariam Gharbi" }).waitFor({ timeout: 60_000 });
    await page.getByRole("heading", { name: /^As Mariam sees/ }).waitFor({ timeout: 120_000 });
    await page.waitForTimeout(2500);
    await shot(page, "05-role-see-as");

    await page.getByRole("button", { name: "See Fusion as Mariam Gharbi" }).click();
    await page.getByText("Seeing Fusion as Mariam Gharbi").waitFor({ timeout: 240_000 });
    await page.waitForTimeout(3000);
    await shot(page, "06-seeing-as-home");

    // Aicha Bouazizi, on Mariam's team, as Mariam sees her.
    await open(page, `/core/people/${aicha.employeeKey}`, page.getByRole("heading", { name: "Aicha Bouazizi" }));
    await page.waitForTimeout(2500);
    await shot(page, "07-seeing-as-person");

    await page.getByRole("button", { name: "Back to Roles" }).click();
    await page.waitForURL((url) => url.pathname.includes("/settings/roles/"), { timeout: 240_000 });
    await open(page, "/core/settings/change-history", page.getByText(/Saw Fusion as/).first());
    await shot(page, "08-change-history");

    await context.close();

    // The drawing, framed the same way: each 1440×900 frame at actual size, pins off.
    const ref = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: "dark" });
    const drawing = await ref.newPage();
    await drawing.goto("file:///" + path.join(__dirname, "..", "plans", "B-164-explorer-3b.html").replace(/\\/g, "/"), { waitUntil: "networkidle" });
    for (const [phase, state, name] of [
      ["admins", { two: false, sheet: false }, "ref-02-administrators-one"],
      ["admins", { two: false, sheet: true }, "ref-03-add-sheet"],
      ["admins", { two: true, sheet: false }, "ref-04-administrators-two"],
      ["one", { two: false, sheet: false }, "ref-05-role-see-as"],
      ["as", { two: false, sheet: false }, "ref-07-seeing-as-person"],
    ]) {
      await drawing.evaluate(([ph, st]) => {
        view.pins = "off"; view.actual = { ...(view.actual || {}), roles: true };
        // eslint-disable-next-line no-undef
        ADM2 = st.two; admSheet = st.sheet;
        goPhase("roles", ph); applyView();
      }, [phase, state]);
      await drawing.waitForTimeout(800);
      await drawing.evaluate(() => {
        const fx = document.querySelector("#stage-roles .fx");
        const host = document.createElement("div");
        host.id = "ref-host";
        host.style.cssText = "position:fixed;inset:0;z-index:99999;width:1440px;height:900px;overflow:hidden;background:#000";
        const clone = fx.cloneNode(true);
        clone.style.transform = "none";
        host.appendChild(clone);
        document.querySelector("#ref-host")?.remove();
        fx.parentElement.parentElement.appendChild(host);
      });
      await drawing.waitForTimeout(300);
      await drawing.screenshot({ path: path.join(OUT, `${name}.png`), clip: { x: 0, y: 0, width: 1440, height: 900 } });
      console.log(`  ${name}.png`);
    }
    await ref.close();
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
