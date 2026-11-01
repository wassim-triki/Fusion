// B-187 journey and screens, through the shell like the browser:
//   node .local-docs/agents/data/journey-b187-import-again.mjs
// A new company brings Carthage in from people.csv and units.csv (drawing-like, written to demo-presets/.work/b187/),
// with awkward files beside them (a PDF, an empty CSV) that say what's wrong. Mid-bring-in Core HR is cut off and
// restarted: the worker resumes the run by itself. A hire made meanwhile takes the employee number of someone later in
// the file, so a batch fails: Stopped partway, nobody doubled. HR renumbers the hire and tries again: the rest comes in.
// Then a changed people file: one new, a few changed, one not in the file (ended), dated from "changes apply from".
// Carthage's administrator can't see, try again or bring in any of it. Screens (dark, 1440×900) go to plans/B-187-screens/.
// Leaves a tenant "Carthage Digital Group <stamp>" behind (Fusion has no tenant deletion).
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { as } from "./demo-presets/client.mjs";
import { activateBootstrap, organization, PLATFORM_ADMIN, roster } from "./demo-presets/foundation.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require("C:/Code/EY/Fusion/Frontend/node_modules/playwright");
const { BASE, call, login } = require(path.join(here, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));
const STACK = path.join(here, "../../../.agents/skills/fusion-dev/scripts/stack.ps1");
const OUT = path.join(here, "..", "plans", "B-187-screens");
const WORK = path.join(here, "demo-presets", ".work", "b187");
await fs.mkdir(OUT, { recursive: true });
await fs.mkdir(WORK, { recursive: true });

const results = [];
function check(label, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  return ok;
}
const data = (r) => r.json?.data;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stack = (...args) => execFileSync("pwsh", ["-File", STACK, ...args], { stdio: "pipe" }).toString();

// ---------- the files ----------
const stamp = Date.now().toString(36);
const domain = `carthage-${stamp}.example.test`;
const today = new Date().toISOString().slice(0, 10);
const people = roster(domain, today);
const { rows: units } = organization();
const csv = (rows) => rows.map((cells) => cells.map((cell) => {
  const text = String(cell ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}).join(",")).join("\n");
const dmy = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const numberOf = new Map(people.map((p) => [p.workerReference, p.employeeNumber]));
const header = ["Emp No", "Full name", "Email", "Position", "Dept", "Reports to", "Location", "Start"];
const row = (p) => [p.employeeNumber, p.name, p.email, p.title, p.organization, numberOf.get(p.managerReference) ?? "", p.location, dmy(p.startDate)];
const write = async (name, text) => { const file = path.join(WORK, name); await fs.writeFile(file, text); return file; };
// 900 more staff across Carthage's teams, so a bring-in lasts long enough to cut off partway.
const teams = [...new Set(people.map((p) => p.organization))];
const leads = people.filter((p) => people.some((q) => q.managerReference === p.workerReference));
const staff = Array.from({ length: 900 }, (_, i) => [`CDG-${String(1001 + i)}`, `Staff${i + 1} Member`, `staff${i + 1}@${domain}`, "Software Engineer",
  teams[i % teams.length], leads[i % leads.length].employeeNumber, "Tunis", dmy(today)]);
const total = people.length + staff.length;
const peoplePath = await write("people.csv", csv([header, ...people.map(row), ...staff]));
const unitsPath = await write("units.csv", csv([["Code", "Unit", "Parent", "Type"], ...units.map(([, code, name, type, parent]) => [code, name, parent, type === "Organization" ? "Company" : type])]));
const pdfPath = await write("payroll-q3.pdf", "%PDF-1.4\n");
const emptyPath = await write("units-2019.csv", "Code,Unit,Parent,Type,Head\n");

// A week later: Malek joins, three people change, Walid (a non-manager) isn't in the file.
const leaver = people.filter((p) => !people.some((q) => q.managerReference === p.workerReference)).at(-1);
const movers = people.filter((p) => p !== leaver && p.managerReference).slice(10, 13);
const otherPlace = (p) => (p.location === "Tunis" ? "Sfax" : "Tunis");
const december = [header, ...people.filter((p) => p !== leaver).map((p) => {
  const cells = row(p);
  if (p === movers[0]) cells[3] = `Senior ${p.title.replace(/^Senior /, "")}`;
  if (p === movers[1]) cells[6] = otherPlace(p);
  if (p === movers[2]) cells[5] = people[2].employeeNumber;
  return cells;
}), ...staff, ["CDG-101", "Malek Ferjani", `malek.ferjani@${domain}`, "Data Engineer", people[2].organization, people[2].employeeNumber, "Tunis", dmy(today)]];
const decemberPath = await write("people-december.csv", csv(december));

// ---------- the company ----------
const company = "Carthage Digital Group";
const admin = people[1].email;
await as(PLATFORM_ADMIN).post("/api/identity/platform-admin/tenants", {
  name: `${company} ${stamp}`, locale: "en-US", timeZone: "Africa/Tunis", industry: "Technology", modules: ["Performance"],
  administratorEmail: admin, administratorFirstName: "Amira", administratorLastName: "Khelifi", idempotencyKey: `journey-b187-${crypto.randomUUID()}`,
});
await activateBootstrap(admin);
let token = await login(admin);
const carthage = await login("amira.khelifi@example.test");
console.log(`company ${company} ${stamp}, administrator ${admin}`);

async function upload(files) {
  const form = new FormData();
  for (const file of files) form.append("files", new Blob([await fs.readFile(file)]), path.basename(file));
  form.append("companyName", company);
  const response = await fetch(`${BASE}/api/corehr/imports`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  return { status: response.status, json: await response.json().catch(() => null) };
}
async function send(method, route, version, body, who = token) {
  const response = await fetch(`${BASE}${route}`, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${who}`, "If-Match": `"${version}"` }, body: JSON.stringify(body ?? {}),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}
const read = async (id) => data(await call("GET", `/api/corehr/imports/${id}`, null, token));
async function until(id, done, seconds) {
  let session;
  for (let i = 0; i < seconds * 2; i++) {
    session = await read(id).catch(() => null);
    if (session && done(session)) return session;
    await sleep(500);
  }
  return session;
}

// ---------- the browser ----------
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
await context.addInitScript(() => { try { window.localStorage.setItem("theme", "dark"); } catch {} });
const page = await context.newPage();
async function shot(name) {
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`      ${name}.png`);
}
async function signIn() {
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
}

try {
  await signIn();

  // Awkward files: each says what's wrong; the people file asks nothing it doesn't need.
  const started = await upload([pdfPath, emptyPath, peoplePath, unitsPath]);
  let session = started.json?.data;
  check("The files start one import, the bad ones kept", started.status === 200 && session.files.length === 4, `${started.status}`);
  check("Each bad file says what's wrong", session.files.map((f) => f.problem ?? "-").join(",") === "format,empty,-,-", session.files.map((f) => f.problem ?? "-").join(","));
  await page.goto(`${BASE}/core/import/${session.id}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await page.getByText("Fusion reads Excel and CSV files").waitFor({ timeout: 240_000 });
  await shot("01-awkward-files");
  session = data(await send("POST", `/api/corehr/imports/${session.id}/leans`, session.version));
  check("Nothing left to answer", session.canBringIn, `${session.openCount} open`);

  // Bring in, cut Core HR off after the first batch of people, start it again: the worker picks the run up.
  check("Carthage's administrator can't bring it in", (await send("POST", `/api/corehr/imports/${session.id}/bring-in`, session.version, { fingerprint: session.fingerprint }, carthage)).status === 404);
  session = data(await send("POST", `/api/corehr/imports/${session.id}/bring-in`, session.version, { fingerprint: session.fingerprint }));
  for (let i = 0; i < 1200 && !(session.progress && session.progress.phase !== "waiting"); i++) { await sleep(50); session = await read(session.id); }
  check("The plan is set and the bring-in under way", session.status === "BringingIn" && session.progress.phase !== "waiting", `${session.progress?.phase} ${session.status}`);
  const lastName = session.wall.at(-1).people.at(-1);
  // Meanwhile HR hires someone (before the cut-off) with the employee number of a person near the end of the file.
  const jobs = data(await call("GET", "/api/corehr/catalog/jobs", null, token));
  const unit = data(await call("GET", `/api/corehr/organization/search?query=${encodeURIComponent(units[1][2])}&asOf=${today}`, null, token))?.[0];
  const clash = people.find((p) => p.name === lastName) ?? { employeeNumber: staff.find((cells) => cells[1] === lastName)[0] };
  const hire = await call("POST", "/api/corehr/employees/hire", {
    firstName: "Nadia", lastName: "Zouari", employeeNumberMode: "Manual", employeeNumber: clash.employeeNumber, startDate: `${today}T00:00:00Z`,
    orgUnitId: unit?.id ?? unit?.orgUnitId, jobId: jobs[0].id }, token);
  check("A hire takes the number of someone later in the file", hire.status === 201, `${hire.status} ${JSON.stringify(hire.json).slice(0, 200)}`);

  stack("-Down", "-Only", "CoreHR");
  console.log("      Core HR stopped");
  stack("-Only", "CoreHR");
  console.log("      Core HR started");
  token = await login(admin);
  const cutAt = (await read(session.id)).progress.people;
  check("Cut off partway: whole batches in, the rest not", cutAt % 25 === 0 && cutAt < total, `${cutAt}`);

  session = await until(session.id, (s) => s.status !== "BringingIn", 240);
  check("The worker resumed the cut-off run, then stopped at the clash", session.status === "Stopped" && session.stopped?.people >= cutAt,
    `${session.status} ${JSON.stringify(session.stopped)}`);
  check("Stopped says the row to try again from", session.stopped?.row > 2 && session.stopped.peopleLeft > 0, `row ${session.stopped?.row}`);
  check("Carthage's administrator can't try it again", (await send("POST", `/api/corehr/imports/${session.id}/resume`, session.version, {}, carthage)).status === 404);
  await page.goto(`${BASE}/core/import/${session.id}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await page.getByRole("heading", { name: /Bringing in stopped/ }).waitFor({ timeout: 240_000 });
  await shot("02-stopped");

  // HR renumbers the hire and tries again: the rest comes in, nobody doubled.
  const hired = data(hire);
  const hex = hired.employeeKey.slice(2).toLowerCase();
  const hiredId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const detail = await call("GET", `/api/corehr/employees/${hiredId}`, null, token);
  const renumber = await send("PUT", `/api/corehr/employees/${hiredId}`, data(detail)?.version, { employeeNumber: "CDG-900" });
  check("The hire is renumbered", renumber.status === 200, `${renumber.status} ${JSON.stringify(renumber.json).slice(0, 200)}`);
  await page.getByRole("button", { name: /Try again/ }).click();
  session = await until(session.id, (s) => s.status !== "BringingIn" && s.status !== "Stopped", 240);
  check("Try again brings the rest in", session.status === "BroughtIn" && session.result?.people === total && session.result?.reportingLines === total - 1,
    `${session.status} ${JSON.stringify(session.result && { people: session.result.people, lines: session.result.reportingLines })}`);
  const counted = execFileSync("pwsh", ["-File", path.join(here, "../../../.agents/skills/fusion-dev/scripts/sql.ps1"), "-Database", "corehr", "-Csv",
    `select count(*) as n, count(distinct "EmployeeNumber") as d from corehr."Employees" e join corehr."CompanyImportSessions" s on s."TenantId" = e."TenantId" where s."Id" = '${session.id}'`]).toString();
  const [n, d] = (counted.match(/\d+/g) ?? []).slice(-2).map(Number);
  check("Nobody is in twice", n === total + 1 && d === n, `${n} people, ${d} numbers`);

  // A week later, a changed people file.
  const second = await upload([decemberPath]);
  session = second.json?.data;
  const again = session?.again;
  check("Importing again matches by employee number", again?.matchedBy === "number", again?.matchedBy);
  check("One new person", again?.new.length === 1 && again.new[0].name === "Malek Ferjani");
  check("Three changed, each with what Fusion has and what the file says", again?.changed.length === 3
    && again.changed.every((p) => p.changes.every((c) => c.from && c.to)), JSON.stringify(again?.changed.map((p) => p.changes)));
  const gone = again?.notInFile ?? [];
  check("Everyone not in the file is a question (the hire, the leaver)", gone.length === 2 && gone.some((p) => p.name === leaver.name), gone.map((p) => p.name).join(", "));
  check("Carthage's administrator can't see it", (await call("GET", `/api/corehr/imports/${session.id}`, null, carthage)).status === 404);
  const applyFrom = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  session = data(await send("PUT", `/api/corehr/imports/${session.id}/answers`, session.version, { key: "applyFrom", value: applyFrom }));
  session = data(await send("PUT", `/api/corehr/imports/${session.id}/answers`, session.version, { key: gone.find((p) => p.name === leaver.name).key, value: "end" }));
  await page.goto(`${BASE}/core/import/${session.id}?step=chart`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await page.getByRole("heading", { name: "Changes apply from" }).waitFor({ timeout: 240_000 });
  await shot("03-importing-again");
  session = data(await send("POST", `/api/corehr/imports/${session.id}/leans`, session.version));
  check("Bring in the changes", session.canBringIn && session.counts.newPeople === 1 && session.counts.changed === 3 && session.counts.ending === 1, JSON.stringify(session.counts));
  session = data(await send("POST", `/api/corehr/imports/${session.id}/bring-in`, session.version, { fingerprint: session.fingerprint }));
  session = await until(session.id, (s) => s.status !== "BringingIn", 120);
  check("They're in", session.status === "BroughtIn" && session.result?.people === 1 && session.result?.changed === 3 && session.result?.ended === 1,
    `${session.status} ${JSON.stringify(session.result && { people: session.result.people, changed: session.result.changed, ended: session.result.ended })}`);

  await page.goto(`${BASE}/core/import`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await page.getByText("Earlier imports").waitFor({ timeout: 240_000 });
  await shot("04-drop-earlier");
  const earlier = data(await call("GET", "/api/corehr/imports/earlier", null, token)) ?? [];
  check("Earlier imports list both, each opening what it brought in", earlier.length === 2
    && (await read(earlier[1].id)).result?.people === total, earlier.map((e) => `${e.people}/${e.changed}`).join(" "));
} finally {
  await browser.close();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
