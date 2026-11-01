// B-186 API journey, the import through the shell like the browser:
//   node .local-docs/agents/data/journey-b186-import.mjs
// A new company (provisioned for the run, Amira as its administrator) brings itself in from Carthage's two
// spreadsheets (carthage-organization.xlsx, carthage-workforce.xlsx) in one import: both files read by what they hold,
// units and people resolved against each other, nothing asked; a stale fingerprint and a stale version refused; the
// bring-in lands 40 units and 100 people with 99 reporting lines; the same files again bring in nobody. Carthage's
// Rim (no import right) is refused, and Carthage's administrator can't see or bring in the new company's import.
// Leaves a tenant "Import Journey <stamp>" behind (Fusion has no tenant deletion).
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { as } from "./demo-presets/client.mjs";
import { activateBootstrap, PLATFORM_ADMIN } from "./demo-presets/foundation.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const { BASE, call, login } = createRequire(import.meta.url)(path.join(here, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));
const results = [];
function check(label, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  return ok;
}
const data = (r) => r.json?.data;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function upload(token, files, companyName) {
  const form = new FormData();
  for (const file of files) form.append("files", new Blob([await fs.readFile(path.join(here, file))]), file);
  form.append("companyName", companyName);
  const response = await fetch(`${BASE}/api/corehr/imports`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  return { status: response.status, json: await response.json().catch(() => null) };
}
async function versioned(token, route, version, body = {}) {
  const response = await fetch(`${BASE}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "If-Match": `"${version}"` },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

const stamp = Date.now().toString(36);
const company = `Import Journey ${stamp}`;
const adminEmail = `amira.khelifi@import-${stamp}.example.test`;
const provisioned = await as(PLATFORM_ADMIN).post("/api/identity/platform-admin/tenants", {
  name: company, locale: "en-US", timeZone: "Africa/Tunis", industry: "Technology", modules: ["Performance"],
  administratorEmail: adminEmail, administratorFirstName: "Amira", administratorLastName: "Khelifi",
  idempotencyKey: `journey-b186-${crypto.randomUUID()}`,
});
check("A new company is provisioned", Boolean(provisioned.tenantId ?? provisioned.id), company);
await activateBootstrap(adminEmail);
const amira = await login(adminEmail);
const rim = await login("rim.mahjoub@example.test");
const carthage = await login("amira.khelifi@example.test");

check("Someone without the import right is refused", (await call("GET", "/api/corehr/imports/active", null, rim)).status === 403);
const started = await upload(amira, ["carthage-organization.xlsx", "carthage-workforce.xlsx"], company);
let session = started.json?.data;
check("Both files start one import", started.status === 200 && session?.files.length === 2, `${started.status} ${JSON.stringify(started.json).slice(0, 300)}`);
const sheets = session.files.flatMap((file) => file.sheets.map((sheet) => `${sheet.name}:${sheet.kind}`));
check("Each file is read by what it holds", sheets.includes("Organization:Units") && sheets.includes("Workforce:People") && sheets.includes("Type values:Unknown"), sheets.join(", "));
const facts = Object.fromEntries(session.facts.map((fact) => [fact.kind, fact]));
check("Managers resolve across the people file by worker reference", facts.managers?.count === 99 && facts.managers?.detail === "reference", JSON.stringify(facts.managers));
check("Everyone's unit is found in the units file", facts.units?.count === 100 && facts.units?.of === 100, JSON.stringify(facts.units));
check("Nothing needs a person", session.openCount === 0 && session.canBringIn, `${session.openCount} open: ${session.checks.map((c) => c.kind).join(", ")}`);
check("The chart holds 100 people and 40 new units", session.counts.people === 100 && session.counts.newUnits === 40, JSON.stringify(session.counts));

check("Carthage's administrator can't see this company's import", (await call("GET", `/api/corehr/imports/${session.id}`, null, carthage)).status === 404);
check("Nor bring it in", (await versioned(carthage, `/api/corehr/imports/${session.id}/bring-in`, session.version, { fingerprint: session.fingerprint })).status === 404);
const stale = await versioned(amira, `/api/corehr/imports/${session.id}/bring-in`, session.version, { fingerprint: "0".repeat(64) });
check("A fingerprint that wasn't reviewed is refused", stale.status === 409 && stale.json?.code === "Changed", `${stale.status} ${stale.json?.code}`);
const oldVersion = await versioned(amira, `/api/corehr/imports/${session.id}/bring-in`, session.version + 7, { fingerprint: session.fingerprint });
check("A stale version is refused", oldVersion.status === 409 && oldVersion.json?.code === "Stale", `${oldVersion.status} ${oldVersion.json?.code}`);

const asked = await versioned(amira, `/api/corehr/imports/${session.id}/bring-in`, session.version, { fingerprint: session.fingerprint });
session = asked.json?.data;
check("The reviewed import is brought in", asked.status === 200 && session?.status === "BringingIn", `${asked.status}`);
let midway = 0;
for (let i = 0; session.status === "BringingIn" && i < 240; i++) {
  await sleep(400);
  session = data(await call("GET", `/api/corehr/imports/${session.id}`, null, amira));
  if (session.progress && session.progress.people > 0 && session.progress.people < 100) midway++;
}
check("It finishes", session.status === "BroughtIn", session.status);
console.log(`      progress read mid-way ${midway} times`);
const result = session.result;
check("40 units, 100 people, 99 reporting lines", result?.units === 40 && result?.people === 100 && result?.reportingLines === 99,
  JSON.stringify(result && { units: result.units, people: result.people, lines: result.reportingLines, jobs: result.jobs, places: result.places }));
check("The Type values sheet is listed as left out", session.leftOut.some((item) => item.kind === "sheet" && item.sheet === "Type values"));
const subjects = data(await call("GET", "/api/corehr/workforce/access-subjects?page=1&pageSize=200", null, amira));
check("The people are in Fusion", (subjects?.items ?? []).length === 100, `${subjects?.items?.length}`);

const again = await upload(amira, ["carthage-workforce.xlsx"], company);
const second = again.json?.data;
check("The same people again bring in nobody (updates are B-187)", again.status === 200 && second?.counts.people === 0 && !second?.canBringIn
  && second.leftOut.find((item) => item.kind === "already")?.count === 100);
check("That import can be dropped", (await versioned(amira, `/api/corehr/imports/${second.id}/discard`, second.version)).status === 200);
check("No import is open after", data(await call("GET", "/api/corehr/imports/active", null, amira))?.id === null);

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
