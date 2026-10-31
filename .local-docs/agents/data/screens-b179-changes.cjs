#!/usr/bin/env node
/**
 * B-179 screens: changes and approvals. Dark at 1440×900, through the shell, in Carthage Digital Group.
 *
 * Mariam Gharbi (manager) describes Aicha Bouazizi's promotion in a sentence, drafts it and sends it for approval;
 * Aicha's page shows it waiting. Amira Khelifi (administrator, HR) sees it in Needs you on Home with Approve and
 * Decline (and the decline popover), on Changes and approvals, opened, and approves it from Home. Settings › Changes
 * and approvals; Aicha's Personal tab with a new address waiting for HR; Mariam's answered list.
 *
 * Temporarily turns approval on for job changes and home addresses; leaves Carthage as it found it (the promotion
 * cancelled, Aicha's address request withdrawn, the settings restored).
 *
 * Also frames the accepted drawing (explorer checkpoint 3: describe a change, Home every day, Aicha's Personal tab)
 * at the same size, as ref-*.png, for the side-by-side review.
 *
 * Usage: node .local-docs/agents/data/screens-b179-changes.cjs
 * Writes PNGs to .local-docs/agents/plans/B-179-screens/<name>.png.
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const { call, login } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const BASE = "http://localhost:3000";
const PASSWORD = process.env.FUSION_LOCAL_PASSWORD;
const OUT = path.join(__dirname, "..", "plans", "B-179-screens");
fs.mkdirSync(OUT, { recursive: true });
const data = (r) => r.json?.data;

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
  const before = data(await call("GET", "/api/corehr/changes/approvals", null, amira));
  const restore = before.types.filter((type) => type.required).map((type) => type.type);
  await call("PUT", "/api/corehr/changes/approvals", { required: ["job", "homeAddress"] }, amira);
  const aicha = data(await call("GET", "/api/corehr/employees/people?q=Aicha", null, amira)).items.find((p) => p.displayName.startsWith("Aicha"));
  const now = new Date();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1)).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
  let appliedChangeId = null;
  let addressRequest = null;

  const browser = await chromium.launch();
  try {
    // Mariam describes and sends the promotion.
    const mariam = await session(browser, "mariam.gharbi@example.test");
    await open(mariam.page, `/core/people/${aicha.employeeKey}`, mariam.page.getByRole("button", { name: /Propose a change/ }));
    await mariam.page.getByRole("button", { name: /Propose a change/ }).click();
    await mariam.page.getByLabel("Describe it").fill(`Promote Aicha to Senior Consultant from 1 ${month}`);
    await shot(mariam.page, "01-describe");
    await mariam.page.getByRole("button", { name: "Draft it" }).click();
    await mariam.page.getByRole("button", { name: "Send for approval" }).waitFor({ timeout: 60_000 });
    await mariam.page.getByLabel(/Note for/).fill("She owns the regression suite and runs the QA guild.");
    await shot(mariam.page, "02-drafted-send-for-approval");
    await mariam.page.getByRole("button", { name: "Send for approval" }).click();
    await mariam.page.getByText(/waits for an answer/).waitFor({ timeout: 30_000 });
    await mariam.page.getByText("Waiting", { exact: true }).first().waitFor({ timeout: 60_000 });
    await mariam.page.getByText("Coming up").scrollIntoViewIfNeeded();
    await shot(mariam.page, "03-aicha-page-waiting");

    // Amira answers.
    const hr = await session(browser, "amira.khelifi@example.test");
    await open(hr.page, "/", hr.page.getByRole("button", { name: "Approve" }).first());
    await shot(hr.page, "04-home-needs-you");
    await hr.page.getByRole("button", { name: "Decline" }).first().click();
    await hr.page.getByLabel("Why not?").fill("Let's wait for the year-end review.");
    await shot(hr.page, "05-home-decline-asks-why");
    await hr.page.keyboard.press("Escape");

    await open(hr.page, "/core/changes", hr.page.getByRole("button", { name: "Approve" }).first());
    await shot(hr.page, "06-changes-and-approvals");
    await hr.page.getByText(/becomes Senior Consultant/).first().click();
    await hr.page.getByText("In their words").waitFor({ timeout: 30_000 });
    await shot(hr.page, "07-request-opened");

    await open(hr.page, "/", hr.page.getByRole("button", { name: "Approve" }).first());
    await hr.page.getByRole("button", { name: "Approve" }).first().click();
    await hr.page.waitForTimeout(3000);
    await shot(hr.page, "08-home-after-approving");

    await open(hr.page, "/core/settings/approvals", hr.page.getByText("Who approves"));
    await shot(hr.page, "09-settings-changes-and-approvals");

    await open(mariam.page, "/core/changes", mariam.page.getByRole("tab", { name: "Answered" }));
    await mariam.page.getByRole("tab", { name: "Answered" }).click();
    await mariam.page.getByText(/Approved by/).first().waitFor({ timeout: 30_000 });
    await shot(mariam.page, "10-mariam-answered");
    const decided = data(await call("GET", "/api/corehr/changes/requests?status=decided", null, amira));
    appliedChangeId = decided.find((r) => r.person.employeeKey === aicha.employeeKey && r.status === "Approved")?.appliedChangeId ?? null;

    // Aicha's own address waits for HR.
    const own = data(await call("GET", `/api/corehr/employees/people/${aicha.employeeKey}/personal`, null, aichaToken));
    const saved = await fetch(`${BASE}/api/corehr/employees/people/${aicha.employeeKey}/personal`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${aichaToken}`, "If-Match": `"${own.version}"` },
      body: JSON.stringify({ preferredName: own.preferredName, mobile: own.mobile, personalEmail: own.personalEmail,
        homeAddress: { street: "4 Avenue de la Liberté", city: "Ariana", postalCode: "2080", country: "Tunisia" },
        dateOfBirth: own.dateOfBirth, emergencyContacts: own.emergencyContacts ?? [] }),
    }).then((r) => r.json());
    addressRequest = saved.data?.pendingHomeAddress?.requestId ?? null;
    const self = await session(browser, "aicha.bouazizi@example.test");
    await open(self.page, "/core/profile?tab=personal", self.page.getByText("Waiting for HR"));
    await self.page.getByText("Waiting for HR").scrollIntoViewIfNeeded();
    await shot(self.page, "11-personal-address-waiting");

    // The drawing, framed the same way: each 1440×900 frame at actual size, pins off.
    const ref = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: "dark" });
    const drawing = await ref.newPage();
    await drawing.goto("file:///" + path.join(__dirname, "..", "plans", "B-164-explorer.html").replace(/\\/g, "/"), { waitUntil: "networkidle" });
    for (const [stage, name] of [["change", "ref-02-describe-a-change"], ["daily", "ref-04-home-needs-you"], ["self", "ref-11-personal-tab"]]) {
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
    if (appliedChangeId) await call("POST", `/api/corehr/employees/people/changes/${appliedChangeId}/cancel`, {}, amira);
    if (addressRequest) await call("POST", `/api/corehr/changes/requests/${addressRequest}/withdraw`, {}, aichaToken);
    const stillPending = data(await call("GET", "/api/corehr/changes/requests", null, amira)) ?? [];
    for (const r of stillPending.filter((r) => r.person.employeeKey === aicha.employeeKey && r.kind === "JobChange"))
      await call("POST", `/api/corehr/changes/requests/${r.id}/decline`, { reason: "Screens clean-up" }, amira);
    await call("PUT", "/api/corehr/changes/approvals", { required: restore }, amira);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
