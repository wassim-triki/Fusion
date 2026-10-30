#!/usr/bin/env node
/**
 * B-177 screens: one roles model. Dark at 1440×900, through the shell, Carthage Digital Group as Amira (tenant
 * administrator). Run after `journey-b177-roles.cjs --keep` (the "Payroll desk" role by rule on Leila's job).
 * Captures every role as one table, HR's page with its preview, Payroll desk's rule, Payroll desk after setting
 * Personal details to Change for everyone (Jobs moves with it, unsaved), the Administrators role, and Leila's Access
 * tab with her roles and why. Changes no data (the edit is discarded).
 *
 * Usage: node .local-docs/agents/data/screens-b177-roles.cjs
 * Writes PNGs to .local-docs/agents/plans/B-177-screens/<name>.png.
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const { call, login } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const BASE = "http://localhost:3000";
const PASSWORD = process.env.FUSION_LOCAL_PASSWORD;
const OUT = path.join(__dirname, "..", "plans", "B-177-screens");
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

async function shot(page, name, options = {}) {
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), ...options });
  console.log(`  ${name}.png`);
}

async function open(page, route, ready) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await ready.waitFor({ state: "visible", timeout: 240_000 });
  await page.waitForTimeout(2000);
}

(async () => {
  const amira = await login("amira.khelifi@example.test");
  const roles = (await call("GET", "/api/identity/core-access/roles", null, amira)).json.data.roles;
  const hr = roles.find((role) => role.name === "HR");
  const payroll = roles.find((role) => role.name === "Payroll desk");
  const admins = roles.find((role) => role.isAdministrators);
  if (!payroll) throw new Error("Run journey-b177-roles.cjs --keep first.");
  const leila = (await call("GET", "/api/corehr/employees/people?q=Leila&pageSize=5", null, amira)).json.data.items[0];

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
    await context.addInitScript(() => { try { window.localStorage.setItem("theme", "dark"); } catch {} });
    const page = await context.newPage();
    await signIn(page, "amira.khelifi@example.test");

    await open(page, "/core/settings/roles", page.getByRole("table"));
    await shot(page, "01-every-role");

    await open(page, `/core/settings/roles/${hr.id}`, page.getByRole("heading", { name: /What HR can do/ }));
    await page.waitForTimeout(2500);
    await shot(page, "02-hr-role");

    await open(page, `/core/settings/roles/${payroll.id}`, page.getByRole("heading", { name: /What Payroll desk can do/ }));
    await page.waitForTimeout(2500);
    await shot(page, "03-rule-role");

    // Personal details → Change: Jobs and history moves with it; nothing is saved.
    await page.getByRole("button", { name: /What Payroll desk can do with personal details/ }).click();
    await page.getByRole("menuitemradio", { name: "Change" }).click();
    await page.waitForTimeout(400);
    await shot(page, "04-linked-unsaved");
    await page.getByRole("button", { name: "Discard" }).click();

    await open(page, `/core/settings/roles/${admins.id}`, page.getByRole("heading", { name: /What Administrators can do/ }));
    await shot(page, "05-administrators");

    await open(page, `/core/people/${leila.employeeKey}?tab=access`, page.getByRole("heading", { name: "Roles" }));
    await page.waitForTimeout(1500);
    await shot(page, "06-access-tab-why");

    await context.close();
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
