// B-186 screens: the import, one step each, dark at 1440×900 through the shell, in a company provisioned for the run.
//   node .local-docs/agents/data/screens-b186-import.mjs
// The files are Carthage's people and units written the way a customer would (people.csv: Emp No, Full name, Email,
// Position, Grade, Dept, Reports to, Location, Start, Salary, Status; units.csv: Code, Unit, Parent, Type), with what
// the drawing shows: Grade only half-recognised, Hiba's unit (PGC) missing from units.csv, "QA Automation Eng." beside
// "QA Automation Engineer", a Salary column, three people who have left. Writes .local-docs/agents/plans/B-186-screens/.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { as } from "./demo-presets/client.mjs";
import { activateBootstrap, organization, PLATFORM_ADMIN, roster } from "./demo-presets/foundation.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const { BASE, call, login } = require(path.join(here, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));
const OUT = path.join(here, "..", "plans", "B-186-screens");
const WORK = path.join(here, "demo-presets", ".work", "b186");
await fs.mkdir(OUT, { recursive: true });
await fs.mkdir(WORK, { recursive: true });

const stamp = Date.now().toString(36);
const domain = `carthage-${stamp}.example.test`;
const today = new Date().toISOString().slice(0, 10);
const people = roster(domain, today);
const { rows: units } = organization();

// ---------- the files ----------
const csv = (rows) => rows.map((cells) => cells.map((cell) => {
  const text = String(cell ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}).join(",")).join("\n");
const dmy = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const grade = (title) => (/^Chief/.test(title) ? (title.includes("Executive") ? "E1" : "E2") : /^VP/.test(title) ? "M2" : /Manager$/.test(title) ? "M1" : /^Senior|Architect/.test(title) ? "L4" : "L3");
const numberOf = new Map(people.map((p) => [p.workerReference, p.employeeNumber]));
const qa = people.filter((p) => p.title === "QA Automation Engineer");
const hiba = people.find((p) => p.firstName === "Hiba") ?? people[40];
const staff = people.map((p) => [
  p.employeeNumber, p.name, p.email, p === qa.at(-1) ? "QA Automation Eng." : p.title, grade(p.title),
  p === hiba ? "PGC" : p.organization, numberOf.get(p.managerReference) ?? "", p.location, dmy(p.startDate),
  String(2400 + ((p.index * 137) % 7000)), "Active",
]);
const leavers = [["CDG-201", "Walid Hamdi", `walid.hamdi@${domain}`, "Software Engineer", "L3", "CDG-TECH-2-D1-T1", "CDG-006", "Tunis", "03/02/2019", "3100", "Left"],
  ["CDG-202", "Sarra Jlassi", `sarra.jlassi@${domain}`, "Product Analyst", "L3", "CDG-TECH-1-D1-T1", "CDG-005", "Sfax", "11/09/2020", "2900", "Left"],
  ["CDG-203", "Karim Ayari", `karim.ayari@${domain}`, "Finance Analyst", "L3", "CDG-CORP-1-D1-T1", "CDG-009", "Tunis", "21/06/2018", "3000", "Left"]];
const peoplePath = path.join(WORK, "people.csv");
const unitsPath = path.join(WORK, "units.csv");
await fs.writeFile(peoplePath, csv([["Emp No", "Full name", "Email", "Position", "Grade", "Dept", "Reports to", "Location", "Start", "Salary", "Status"], ...staff, ...leavers]));
await fs.writeFile(unitsPath, csv([["Code", "Unit", "Parent", "Type"], ...units.map(([, code, name, type, parent]) => [code, name, parent, type === "Organization" ? "Company" : type])]));

// ---------- the company ----------
const company = "Carthage Digital Group";
const admin = people[1].email;
await as(PLATFORM_ADMIN).post("/api/identity/platform-admin/tenants", {
  name: `${company} ${stamp}`, locale: "en-US", timeZone: "Africa/Tunis", industry: "Technology", modules: ["Performance"],
  administratorEmail: admin, administratorFirstName: "Amira", administratorLastName: "Khelifi", idempotencyKey: `screens-b186-${crypto.randomUUID()}`,
});
await activateBootstrap(admin);
const token = await login(admin);
console.log(`company ${company} ${stamp}, administrator ${admin}`);

async function upload(files) {
  const form = new FormData();
  for (const file of files) form.append("files", new Blob([await fs.readFile(file)], { type: "text/csv" }), path.basename(file));
  form.append("companyName", company);
  const response = await fetch(`${BASE}/api/corehr/imports`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  return (await response.json()).data;
}
async function change(method, route, version, body) {
  const response = await fetch(`${BASE}${route}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "If-Match": `"${version}"` }, body: JSON.stringify(body ?? {}) });
  const json = await response.json();
  if (!response.ok) throw new Error(`${method} ${route} ${response.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json.data;
}

// ---------- the screens ----------
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
await context.addInitScript(() => { try { window.localStorage.setItem("theme", "dark"); } catch {} });
const page = await context.newPage();
async function shot(name) {
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ${name}.png`);
}
try {
  await page.goto(`${BASE}/auth/signin`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.locator('button[type="submit"]').waitFor({ timeout: 120_000 });
  for (let i = 0; i < 5; i++) {
    await page.fill("#email", admin);
    await page.fill("#password", process.env.FUSION_LOCAL_PASSWORD);
    await page.waitForTimeout(400);
    if ((await page.inputValue("#email")) === admin) break;
  }
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 120_000 });

  await page.goto(`${BASE}/core/import`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await page.getByText("Drop your spreadsheets here").waitFor({ timeout: 240_000 });
  await shot("01-drop");

  let session = await upload([peoplePath, unitsPath]);
  await page.goto(`${BASE}/core/import/${session.id}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await page.getByRole("heading", { name: "What Fusion understood" }).waitFor({ timeout: 240_000 });
  await shot("02-understood");

  const question = session.questions.find((item) => item.header === "Grade");
  session = await change("PUT", `/api/corehr/imports/${session.id}/answers`, session.version, { key: question.key, value: "jobLevel" });
  const houssem = session.chart.people.find((item) => item.managerKey && item.directCount === 0);
  const boss = session.chart.people.find((item) => item.directCount > 3 && item.key !== houssem.managerKey);
  session = await change("POST", `/api/corehr/imports/${session.id}/fixes`, session.version,
    { personKey: houssem.key, field: "manager", value: boss.key, text: `${houssem.name.split(" ")[0]} reports to ${boss.name.split(" ")[0]}` });
  await page.goto(`${BASE}/core/import/${session.id}?step=chart`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await page.getByRole("heading", { name: "To check" }).waitFor({ timeout: 240_000 });
  await page.getByRole("button", { name: /unit isn't in units.csv/ }).first().click();
  await shot("03-chart-people");
  await page.getByRole("radio", { name: /Jobs/ }).click().catch(async () => page.getByText(/^Jobs · /).click());
  await shot("04-chart-jobs");

  session = await change("POST", `/api/corehr/imports/${session.id}/leans`, session.version);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Bring in \d+ people/ }).waitFor({ timeout: 240_000 });
  await page.getByRole("button", { name: /Bring in \d+ people/ }).click();
  await page.getByRole("heading", { name: `Bringing in ${company}` }).waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => /[1-9]\d* of \d+ people/.test(document.body.innerText), null, { timeout: 60_000 }).catch(() => {});
  await page.screenshot({ path: path.join(OUT, "05-bringing-in.png") });
  console.log("  05-bringing-in.png");
  await page.getByRole("heading", { name: `${company} is in Fusion` }).waitFor({ timeout: 300_000 });
  await shot("06-brought-in");
  const done = (await call("GET", `/api/corehr/imports/${session.id}`, null, token)).json.data;
  console.log(`brought in: ${JSON.stringify(done.result && { people: done.result.people, units: done.result.units, jobs: done.result.jobs, lines: done.result.reportingLines })}`);
} finally {
  await browser.close();
}
