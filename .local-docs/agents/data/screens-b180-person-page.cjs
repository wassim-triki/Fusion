#!/usr/bin/env node
/**
 * B-180 screens: one person page. Dark at 1440×900, through the shell, in Carthage Digital Group.
 *
 * Amira Khelifi (administrator, HR) on Aicha Bouazizi's page: Overview, Job (family and level, B-195), Documents,
 * Access, the ⋯ menu. Aicha on her own page (/core/profile): Personal with who sees each part, then Identity below.
 * Omar Mansour (a manager outside her branch) on her page: Overview and Performance only. The Performance tab.
 *
 * Adds one document for Aicha and removes it again. Also frames the accepted drawing ("Aicha's page" and "Aicha's
 * page, other tabs": Personal and Access) at the same size, as ref-*.png, for the side-by-side review.
 *
 * Usage: node .local-docs/agents/data/screens-b180-person-page.cjs
 * Writes PNGs to .local-docs/agents/plans/B-180-screens/<name>.png.
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const { call, login } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const BASE = "http://localhost:3000";
const PASSWORD = process.env.FUSION_LOCAL_PASSWORD;
const OUT = path.join(__dirname, "..", "plans", "B-180-screens");
fs.mkdirSync(OUT, { recursive: true });
const data = (r) => r.json?.data;
const ACCESS_TITLE = require(path.join(__dirname, "../../../Frontend/apps/core/messages/en/profile.json")).fusionAccess.title;

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
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ${name}.png`);
}

async function open(page, route, ready) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await ready.waitFor({ state: "visible", timeout: 240_000 });
  await page.waitForTimeout(2500);
}

async function session(browser, email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await context.addInitScript(() => { try { window.localStorage.setItem("theme", "dark"); } catch {} });
  const page = await context.newPage();
  await signIn(page, email);
  return { context, page };
}

(async () => {
  const amira = await login("amira.khelifi@example.test");
  const aichaToken = await login("aicha.bouazizi@example.test");
  const aicha = data(await call("GET", "/api/corehr/employees/people?q=Aicha", null, amira)).items.find((p) => p.displayName.startsWith("Aicha"));
  const page = `/core/people/${aicha.employeeKey}`;

  // One document on her page, added by her.
  const form = new FormData();
  form.append("file", new Blob([Buffer.from("%PDF-1.7\n% employment contract\n")], { type: "application/pdf" }), "Employment contract.pdf");
  const added = await (await fetch(`${BASE}/api/corehr/employees/people/${aicha.employeeKey}/documents`, {
    method: "POST", headers: { Authorization: `Bearer ${aichaToken}` }, body: form,
  })).json();
  const docId = added?.data?.id;

  const browser = await chromium.launch();
  try {
    const hr = await session(browser, "amira.khelifi@example.test");
    await open(hr.page, page, hr.page.getByRole("heading", { name: "Job and history" }));
    await shot(hr.page, "01-overview-hr");
    await hr.page.getByRole("button", { name: "More actions" }).first().click();
    await shot(hr.page, "02-more-menu");
    await hr.page.keyboard.press("Escape");
    await open(hr.page, `${page}?tab=job`, hr.page.getByRole("heading", { name: "The job" }));
    await shot(hr.page, "03-job");
    await open(hr.page, `${page}?tab=documents`, hr.page.getByText("Employment contract.pdf"));
    await shot(hr.page, "04-documents-hr");
    await open(hr.page, `${page}?tab=access`, hr.page.getByRole("heading", { name: ACCESS_TITLE }));
    await shot(hr.page, "05-access-hr");
    await open(hr.page, `${page}?tab=performance`, hr.page.getByRole("heading", { name: "Objectives" }));
    await shot(hr.page, "06-performance");
    await hr.context.close();

    const self = await session(browser, "aicha.bouazizi@example.test");
    await open(self.page, "/core/profile?tab=personal", self.page.getByRole("heading", { name: "Home address" }));
    await shot(self.page, "07-personal-self");
    await self.page.getByRole("heading", { name: "Identity" }).scrollIntoViewIfNeeded();
    await shot(self.page, "08-personal-self-below");
    await open(self.page, "/core/profile", self.page.getByRole("heading", { name: "Job and history" }));
    await shot(self.page, "09-overview-self");
    await self.context.close();

    const colleague = await session(browser, "omar.mansour@example.test");
    await open(colleague.page, page, colleague.page.getByRole("heading", { name: "Job and history" }));
    await shot(colleague.page, "10-overview-colleague");
    await colleague.context.close();

    // The drawing, framed the same way: each 1440×900 frame at actual size, pins off.
    const ref = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: "dark" });
    const drawing = await ref.newPage();
    await drawing.goto("file:///" + path.join(__dirname, "..", "plans", "B-164-explorer.html").replace(/\\/g, "/"), { waitUntil: "networkidle" });
    for (const [stage, phase, name] of [["person", null, "ref-01-overview"], ["self", "personal", "ref-07-personal"], ["self", "access", "ref-05-access"]]) {
      if (phase) {
        await drawing.evaluate(() => document.querySelector("#ref-host")?.remove());
        const button = drawing.locator(`[data-phases="${stage}"] button[data-phase="${phase}"]`);
        if (await button.count()) await button.first().click();
        await drawing.waitForTimeout(400);
      }
      const framed = await drawing.evaluate((id) => {
        try { view.pins = "off"; applyView(); } catch {}
        const fx = document.querySelector(`#stage-${id} .fx`);
        if (!fx) return false;
        document.querySelector("#ref-host")?.remove();
        const host = document.createElement("div");
        host.id = "ref-host";
        host.style.cssText = "position:fixed;inset:0;z-index:99999;width:1440px;height:900px;overflow:hidden;background:#000";
        const clone = fx.cloneNode(true);
        clone.style.transform = "none";
        clone.querySelectorAll(".pin").forEach((pin) => pin.remove());
        host.appendChild(clone);
        document.body.appendChild(host);
        return true;
      }, stage);
      if (!framed) { console.log(`  (no frame for ${stage})`); continue; }
      await drawing.waitForTimeout(400);
      await drawing.screenshot({ path: path.join(OUT, `${name}.png`), clip: { x: 0, y: 0, width: 1440, height: 900 } });
      console.log(`  ${name}.png`);
    }
    await ref.close();
  } finally {
    await browser.close();
    if (docId) await call("DELETE", `/api/corehr/employees/people/${aicha.employeeKey}/documents/${docId}`, null, amira);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
