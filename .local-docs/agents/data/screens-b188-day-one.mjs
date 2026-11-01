// B-188 screens, dark at 1440×900 through the shell: activation with "Do you work here?", Home on day one, the import's
// Brought in with the guide's segments, and Home every day (Carthage's Mariam Gharbi, a manager).
//   node .local-docs/agents/data/screens-b188-day-one.mjs
// Provisions "Carthage Digital Group <stamp>" whose administrator Amira activates in the browser and says yes, Chief
// Technology Officer; the company is then brought in from Carthage's roster (people.csv + units.csv, Amira by email).
// Writes .local-docs/agents/plans/B-188-screens/.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { as } from "./demo-presets/client.mjs";
import { organization, PLATFORM_ADMIN, roster } from "./demo-presets/foundation.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const { BASE, MAILPIT, PASSWORD, login } = require(path.join(here, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));
const OUT = path.join(here, "..", "plans", "B-188-screens");
const WORK = path.join(here, "demo-presets", ".work", "b188");
await fs.mkdir(OUT, { recursive: true });
await fs.mkdir(WORK, { recursive: true });

const stamp = Date.now().toString(36);
const domain = `carthage-${stamp}.example.test`;
const today = new Date().toISOString().slice(0, 10);
const people = roster(domain, today);
const { rows: units } = organization();
const company = `Carthage Digital Group ${stamp}`;
const admin = people[1].email;

const csv = (rows) => rows.map((cells) => cells.map((cell) => {
  const text = String(cell ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}).join(",")).join("\n");
const dmy = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const numberOf = new Map(people.map((p) => [p.workerReference, p.employeeNumber]));
const peoplePath = path.join(WORK, "people.csv");
const unitsPath = path.join(WORK, "units.csv");
await fs.writeFile(peoplePath, csv([["Emp No", "Full name", "Email", "Position", "Dept", "Reports to", "Location", "Start"],
  ...people.map((p) => [p.employeeNumber, p.name, p.email, p.title, p.organization, numberOf.get(p.managerReference) ?? "", p.location, dmy(p.startDate)])]));
await fs.writeFile(unitsPath, csv([["Code", "Unit", "Parent", "Type"], ...units.map(([, code, name, type, parent]) => [code, name, parent, type === "Organization" ? "Company" : type])]));

await as(PLATFORM_ADMIN).post("/api/identity/platform-admin/tenants", {
  name: company, locale: "en-US", timeZone: "Africa/Tunis", industry: "Technology", modules: ["Performance"],
  administratorEmail: admin, administratorFirstName: "Amira", administratorLastName: "Khelifi", idempotencyKey: `screens-b188-${crypto.randomUUID()}`,
});
console.log(`company ${company}, administrator ${admin}`);
let credential = null;
for (let i = 0; i < 30 && !credential; i++) {
  const list = await (await fetch(`${MAILPIT}/api/v1/search?query=to:${encodeURIComponent(admin)}`)).json();
  const message = list.messages?.[0];
  if (message) {
    const full = await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json();
    credential = `${full.Text ?? ""}\n${full.HTML ?? ""}`.match(/[?&]credential=([^&"'<>\s]+)/)?.[1]?.replace(/&amp;/g, "&");
  } else await new Promise((r) => setTimeout(r, 1000));
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
await context.addInitScript(() => { try { window.localStorage.setItem("theme", "dark"); } catch {} });
const page = await context.newPage();
async function shot(name) {
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ${name}.png`);
}
async function signIn(email) {
  await page.goto(`${BASE}/auth/signin`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.locator('button[type="submit"]').waitFor({ timeout: 120_000 });
  for (let i = 0; i < 5; i++) {
    await page.fill("#email", email);
    await page.fill("#password", PASSWORD);
    await page.waitForTimeout(400);
    if ((await page.inputValue("#email")) === email) break;
  }
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 120_000 });
}

try {
  // 01 activation: the form, yes, the job title
  await page.goto(`${BASE}/activate-invitation?credential=${credential}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.locator("#password").waitFor({ timeout: 120_000 });
  await page.fill("#firstName", "Amira");
  await page.fill("#lastName", "Khelifi");
  await page.fill("#password", PASSWORD);
  await page.fill("#confirmPassword", PASSWORD);
  await page.fill("#jobTitle", "Chief Technology Officer");
  await page.mouse.move(0, 0);
  await shot("01-activation");

  // 02 Home on day one
  await page.locator('button[type="submit"]').click();
  await page.getByRole("heading", { name: `Set up ${company}` }).waitFor({ timeout: 240_000 });
  await page.getByText("Drop your spreadsheets here").waitFor({ timeout: 60_000 });
  await shot("02-home-day-one");

  // 03 Brought in, with the guide's segments
  const token = await login(admin);
  const form = new FormData();
  for (const file of [peoplePath, unitsPath]) form.append("files", new Blob([await fs.readFile(file)], { type: "text/csv" }), path.basename(file));
  form.append("companyName", company);
  let session = (await (await fetch(`${BASE}/api/corehr/imports`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form })).json()).data;
  const send = async (route, body) => {
    const response = await fetch(`${BASE}${route}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "If-Match": `"${session.version}"` }, body: JSON.stringify(body ?? {}) });
    return (await response.json()).data;
  };
  session = await send(`/api/corehr/imports/${session.id}/leans`);
  session = await send(`/api/corehr/imports/${session.id}/bring-in`, { fingerprint: session.fingerprint });
  for (let i = 0; session?.status === "BringingIn" && i < 300; i++) {
    await new Promise((r) => setTimeout(r, 500));
    session = (await (await fetch(`${BASE}/api/corehr/imports/${session.id}`, { headers: { Authorization: `Bearer ${token}` } })).json()).data;
  }
  console.log(`  import ${session?.status}`);
  await page.goto(`${BASE}/core/import/${session.id}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await page.getByRole("heading", { name: /is in Fusion/ }).waitFor({ timeout: 300_000 });
  await page.getByRole("progressbar").waitFor({ timeout: 60_000 });
  await shot("03-brought-in");

  // 04 Home after the import: the guide moves to inviting
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await page.getByRole("heading", { name: `Set up ${company}` }).waitFor({ timeout: 240_000 });
  await shot("04-home-after-import");

  // 05 Home every day: Mariam Gharbi, a manager at Carthage
  await context.clearCookies();
  await page.evaluate(() => window.localStorage.removeItem("ey_hr_auth"));
  await signIn("mariam.gharbi@example.test");
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await page.getByRole("heading", { name: "Needs you" }).waitFor({ timeout: 240_000 });
  await page.waitForTimeout(3000);
  await shot("05-home-every-day");
} finally {
  await browser.close();
}
