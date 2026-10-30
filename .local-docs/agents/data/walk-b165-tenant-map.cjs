#!/usr/bin/env node
/**
 * B-165 tenant map walk (dark, 1440x900). Two parts:
 *   empty   provisions a new empty tenant "Map · Empty <stamp>" through the platform API (Performance on), opens the
 *           administrator's bootstrap invitation from Mailpit in the browser, activates it as Amira Khelifi, then walks
 *           every tenant destination of the brand-new tenant.
 *   midyear walks the Mid-year demo preset as Amira (tenant admin, HR), Mariam (manager) and Aicha (employee).
 * Usage: node .local-docs/agents/data/walk-b165-tenant-map.cjs [empty|empty-resume|midyear|all]
 *   empty-resume signs in to the tenant the last `empty` run created and captures the pages still missing.
 *   Pages already in walk.json are skipped; B165_FORCE=1 captures them again.
 * Writes full-page PNGs and walk.json (headings, sidebar, actions, empty-state text per page) to
 * .local-docs/agents/plans/B-164-screens/. The empty part creates one tenant and one account; midyear changes no data.
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const helper = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");

const BASE = "http://localhost:3000";
const GATEWAY = "http://localhost:5000";
const PASSWORD = process.env.FUSION_LOCAL_PASSWORD;
const OUT = path.join(__dirname, "..", "plans", "B-164-screens");
const WALK = path.join(OUT, "walk.json");
fs.mkdirSync(OUT, { recursive: true });
const record = fs.existsSync(WALK) ? JSON.parse(fs.readFileSync(WALK, "utf8")) : {};

const PLATFORM_ADMIN = "admin@ey-hr.com";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function post(token, route, body) {
  const response = await fetch(`${GATEWAY}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (response.status >= 400) throw new Error(`POST ${route} -> ${response.status} ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

async function bootstrapLink(email) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const list = await (await fetch(`${helper.MAILPIT}/api/v1/search?query=to:${encodeURIComponent(email)}`)).json();
    const message = list.messages?.[0];
    if (message) {
      const full = await (await fetch(`${helper.MAILPIT}/api/v1/message/${message.ID}`)).json();
      const body = `${full.Text ?? ""}\n${full.HTML ?? ""}`.replace(/&amp;/g, "&");
      const link = body.match(/https?:\/\/[^\s"'<>]+credential=[^\s"'<>]+/)?.[0];
      if (!link) throw new Error(`No activation link in the mail to ${email}.`);
      return { link, subject: full.Subject };
    }
    await sleep(1000);
  }
  throw new Error(`No bootstrap invitation for ${email}.`);
}

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
  // The dev server can stall a first sign-in; one more press after a long wait.
  try {
    await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 120_000, waitUntil: "commit" });
  } catch {
    if ((await page.inputValue("#password").catch(() => "")) === "") await page.fill("#password", PASSWORD);
    await submit.click();
    await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 180_000, waitUntil: "commit" });
  }
}

/** What a page shows, compactly: where it landed, its headings, sidebar, actions and any empty/denied text. */
async function capture(page) {
  return page.evaluate(() => {
    const text = (el) => (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const all = (sel, root = document) => [...root.querySelectorAll(sel)].filter(visible).map(text).filter(Boolean);
    const nav = document.querySelector("nav, aside");
    const main = document.querySelector("main") || document.body;
    return {
      title: document.title,
      headings: all("h1, h2, h3", main).slice(0, 30),
      sidebar: nav ? all("a, button", nav).slice(0, 40) : [],
      actions: all("button, a[role=button]", main).slice(0, 40),
      tabs: all('[role="tab"]', main),
      body: text(main).slice(0, 1500),
    };
  });
}

// The notification stream keeps the network busy, so pages never go idle: wait for skeletons to clear instead.
async function settled(page, settle) {
  await page.waitForTimeout(1500);
  await page.waitForFunction(
    () => !document.querySelector('[aria-busy="true"], .animate-pulse, [data-slot="skeleton"]'),
    null,
    { timeout: 30_000 },
  ).catch(() => {});
  await page.waitForTimeout(settle);
}

const scrub = (url) => url.replace(/credential=[^&]+/, "credential=…");

async function visit(page, key, url, settle = 2000) {
  if (record[key] && !record[key].error && process.env.B165_FORCE !== "1") return;
  const started = Date.now();
  try {
    await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
    await settled(page, settle);
    const info = await capture(page);
    await page.screenshot({ path: path.join(OUT, `${key}.png`), fullPage: true });
    record[key] = { url: scrub(url), landed: scrub(new URL(page.url()).pathname + new URL(page.url()).search), ms: Date.now() - started, ...info };
    console.log(`  ${key}  ${url} -> ${record[key].landed}`);
  } catch (error) {
    record[key] = { url, error: String(error).slice(0, 300) };
    console.log(`  ${key}  FAILED ${String(error).slice(0, 120)}`);
  }
  fs.writeFileSync(WALK, JSON.stringify(record, null, 2));
}

const TENANT_DESTINATIONS = [
  ["home", "/"],
  ["core-overview", "/core"],
  ["core-getting-started", "/core/getting-started"],
  ["core-organization", "/core/organization"],
  ["core-people", "/core/people"],
  ["core-people-hire", "/core/people/hire"],
  ["core-people-import", "/core/people/import"],
  ["core-org-chart", "/core/org-chart"],
  ["core-team", "/core/team"],
  ["core-profile", "/core/profile"],
  ["core-workforce-access", "/core/workforce-access"],
  ["core-access", "/core/access"],
  ["core-settings", "/core/settings"],
  ["core-settings-company", "/core/settings/company"],
  ["core-settings-employee-fields", "/core/settings/employee-fields"],
  ["core-settings-roles", "/core/settings/roles"],
  ["core-settings-invitations", "/core/settings/invitations"],
  ["core-settings-change-history", "/core/settings/change-history"],
  ["settings-you", "/settings"],
  ["perf-overview", "/performance"],
  ["perf-plan", "/performance/plan"],
  ["perf-team", "/performance/team"],
  ["perf-cycle", "/performance/cycle"],
  ["perf-reviews", "/performance/reviews"],
  ["perf-settings", "/performance/settings"],
];

/** Continues the empty tenant's walk as its administrator, skipping pages already captured. */
async function emptyResume(browser) {
  const email = record.empty_meta?.email;
  if (!email) throw new Error("No empty tenant in walk.json; run `empty` first.");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await context.addInitScript(() => { try { window.localStorage.setItem("theme", "dark"); } catch {} });
  const page = await context.newPage();
  await signIn(page, email);
  for (const [key, url] of TENANT_DESTINATIONS) await visit(page, `empty-${key}`, url);
  await context.close();
}

async function empty(browser) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const email = `amira.khelifi@map-empty-${stamp}.example.test`;
  const platformToken = await helper.login(PLATFORM_ADMIN);
  const provisioned = await post(platformToken, "/api/identity/platform-admin/tenants", {
    name: `Map · Empty ${stamp}`, locale: "en-US", timeZone: "Africa/Tunis", industry: "Technology", modules: ["Performance"],
    administratorEmail: email, administratorFirstName: "Amira", administratorLastName: "Khelifi",
    idempotencyKey: `b165-map-empty-${stamp}`,
  });
  const tenantId = provisioned.data?.tenantId ?? provisioned.tenantId ?? provisioned.data?.id ?? provisioned.id;
  console.log(`empty tenant ${tenantId} · ${email}`);
  const { link, subject } = await bootstrapLink(email);
  record.empty_meta = { tenantId, email, subject, link: link.replace(/credential=[^&]+/, "credential=…") };

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await context.addInitScript(() => { try { window.localStorage.setItem("theme", "dark"); } catch {} });
  const page = await context.newPage();
  const local = link.replace(/^https?:\/\/[^/]+/, BASE);
  await visit(page, "empty-00-activation", local.replace(BASE, ""), 5000);

  // Fill whatever the activation form asks: names when present, the password twice when confirmed.
  const fill = async (selector, value) => { const field = page.locator(selector).first(); if (await field.count()) await field.fill(value); };
  await fill('input[name="firstName"], #firstName', "Amira");
  await fill('input[name="lastName"], #lastName', "Khelifi");
  const passwords = page.locator('input[type="password"]');
  for (let index = 0; index < (await passwords.count()); index++) await passwords.nth(index).fill(PASSWORD);
  const consent = page.locator('input[type="checkbox"]');
  for (let index = 0; index < (await consent.count()); index++) await consent.nth(index).check().catch(() => {});
  await page.screenshot({ path: path.join(OUT, "empty-01-activation-filled.png"), fullPage: true });
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((url) => !/activate|invitation/.test(url.pathname), { timeout: 120_000 }).catch(() => {});
  await page.waitForTimeout(6000);
  const after = await capture(page);
  await page.screenshot({ path: path.join(OUT, "empty-02-after-activation.png"), fullPage: true });
  record["empty-02-after-activation"] = { landed: new URL(page.url()).pathname + new URL(page.url()).search, ...after };
  fs.writeFileSync(WALK, JSON.stringify(record, null, 2));
  console.log(`  landed after activation: ${record["empty-02-after-activation"].landed}`);

  if (/\/auth\//.test(page.url())) await signIn(page, email);
  for (const [key, url] of TENANT_DESTINATIONS) await visit(page, `empty-${key}`, url);
  await context.close();
}

async function midyear(browser) {
  const domain = "midyear-5.example.test";
  const people = {
    admin: `amira.khelifi@${domain}`,
    manager: `mariam.gharbi@${domain}`,
    employee: `aicha.bouazizi@${domain}`,
  };
  for (const [role, email] of Object.entries(people)) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
    await context.addInitScript(() => { try { window.localStorage.setItem("theme", "dark"); } catch {} });
    const page = await context.newPage();
    await signIn(page, email);
    const destinations = role === "admin"
      ? TENANT_DESTINATIONS
      : TENANT_DESTINATIONS.filter(([key]) => !key.startsWith("core-settings-") && key !== "core-people-hire" && key !== "core-people-import");
    for (const [key, url] of destinations) await visit(page, `mid-${role}-${key}`, url);
    if (role === "admin") {
      // A person's record (Aicha's, looked up by name) and each of its tabs, then the change sheets.
      const token = await helper.login(email);
      const found = await helper.call("GET", "/api/corehr/employees/people?pageSize=200", undefined, token);
      const aicha = found.json?.data?.items?.find((person) => person.firstName === "Aicha");
      if (aicha) {
        const local = `/core/people/${aicha.employeeKey}`;
        for (const tab of ["", "?tab=personal", "?tab=performance", "?tab=access", "?change=job", "?change=end"]) {
          await visit(page, `mid-admin-person${tab ? "-" + tab.slice(1).replace("=", "-") : ""}`, `${local}${tab}`);
        }
        const detail = await helper.call("GET", `/api/corehr/employees/people/${aicha.employeeKey}`, undefined, token);
        const employeeId = JSON.stringify(detail.json?.data ?? {}).match(/"employeeId":"([0-9a-f-]{36})"/)?.[1];
        if (employeeId) await visit(page, "mid-admin-perf-person", `/performance/people/${employeeId}`);
      }
    }
    await context.close();
  }
}

(async () => {
  const which = process.argv[2] ?? "all";
  const browser = await chromium.launch();
  try {
    if (which === "empty" || which === "all") await empty(browser);
    if (which === "empty-resume") await emptyResume(browser);
    if (which === "midyear" || which === "all") await midyear(browser);
  } finally {
    await browser.close();
    fs.writeFileSync(WALK, JSON.stringify(record, null, 2));
  }
})().catch((error) => { console.error(error); process.exit(1); });
