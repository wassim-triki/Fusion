// B-188 API journey, day one through the shell like the browser:
//   node .local-docs/agents/data/journey-b188-day-one.mjs
// A new company is provisioned; its administrator Amira activates from the Mailpit invitation and answers "Do you work
// here? Yes, Chief Technology Officer": she becomes the company's first person and her session opens her record. The
// setup guide's steps follow the company's data: one person, nobody invited; the import brings in five more (Amira
// matched by email, not doubled; the day-one root opens when the company's history starts); an invitation makes the
// invite step done. Sami, invited, signs in: his Home reads (card, checklists, Coming up) answer, and he can't make
// himself a first person. Refusals: no rights (403), someone with a record already (409), a second first person (409).
// Leaves a tenant "Day One <stamp>" behind (Fusion has no tenant deletion).
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { as } from "./demo-presets/client.mjs";
import { activateBootstrap, PLATFORM_ADMIN } from "./demo-presets/foundation.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const { BASE, PASSWORD, call, login, inviteToken } = createRequire(import.meta.url)(path.join(here, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));
const results = [];
function check(label, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  return ok;
}
const data = (r) => r.json?.data;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const claims = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
const employeeIdOf = (token) => {
  const c = claims(token);
  return c.employee_id ?? Object.entries(c).find(([key]) => key.endsWith("employee_id"))?.[1] ?? null;
};
async function versioned(token, method, route, version, body = {}) {
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "If-Match": `"${version}"` },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}
async function guide(token) {
  const people = data(await call("GET", "/api/corehr/employees/people?page=1&pageSize=1", null, token));
  const access = data(await call("GET", "/api/corehr/workforce/access-subjects/summary", null, token));
  return { people: people?.totalCount, invited: access?.invitePendingCount, signedIn: access?.activeAccountCount };
}

const stamp = Date.now().toString(36);
const company = `Day One ${stamp}`;
const domain = `day-one-${stamp}.example.test`;
const adminEmail = `amira.khelifi@${domain}`;
const provisioned = await as(PLATFORM_ADMIN).post("/api/identity/platform-admin/tenants", {
  name: company, locale: "en-US", timeZone: "Africa/Tunis", industry: "Technology", modules: ["Performance"],
  administratorEmail: adminEmail, administratorFirstName: "Amira", administratorLastName: "Khelifi",
  idempotencyKey: `journey-b188-${crypto.randomUUID()}`,
});
check("A new company is provisioned", Boolean(provisioned.tenantId ?? provisioned.id), company);
await activateBootstrap(adminEmail);
let amira = await login(adminEmail);
check("Amira's account opens no record yet", !employeeIdOf(amira));
check("Day one: the company has nobody", (await guide(amira)).people === 0);

const rim = await login("rim.mahjoub@example.test");
const carthage = await login("amira.khelifi@example.test");
const yes = { firstName: "Amira", lastName: "Khelifi", jobTitle: "Chief Technology Officer", companyName: company };
check("Someone without organization and people rights can't make a first person",
  (await call("POST", "/api/corehr/me/first-person", yes, rim)).status === 403);
check("Someone who already has a record is refused", (await call("POST", "/api/corehr/me/first-person", yes, carthage)).status === 409);

const made = await call("POST", "/api/corehr/me/first-person", yes, amira);
check("Yes, I work here: Amira becomes the first person, linked", made.status === 200 && data(made)?.linked === true, JSON.stringify(made.json).slice(0, 200));
amira = await login(adminEmail);
check("Her session now opens her record", Boolean(employeeIdOf(amira)));
const card = data(await call("GET", "/api/corehr/me/card", null, amira));
check("Her card reads her name and job", card?.displayName === "Amira Khelifi" && card?.jobTitle === "Chief Technology Officer", JSON.stringify(card));
check("A second first person is refused", (await call("POST", "/api/corehr/me/first-person", { ...yes, firstName: "Sami" }, amira)).status === 409);
let g = await guide(amira);
check("Guide: one person (Amira), nobody invited", g.people === 1 && g.invited === 0, JSON.stringify(g));
const readiness = data(await call("GET", "/api/corehr/organization/readiness", null, amira));
check("The company's root exists from day one", readiness?.hasPermanentRoot && readiness?.permanentRootFirstEffectiveDate >= "2026-11-01", readiness?.permanentRootFirstEffectiveDate);

// The company's file: Amira by her email, under the CEO.
const people = [
  "Emp No,Full name,Email,Position,Dept,Reports to,Start",
  `CDG-001,Sami Ben Youssef,sami.benyoussef@${domain},Chief Executive Officer,${company},,07/05/2017`,
  `CDG-002,Amira Khelifi,${adminEmail},Chief Technology Officer,Engineering,CDG-001,14/01/2022`,
  `CDG-003,Omar Mansour,omar.mansour@${domain},"VP, Engineering",Engineering,CDG-002,01/03/2020`,
  `CDG-004,Houssem Jaziri,houssem.jaziri@${domain},QA Automation Engineer,Engineering,CDG-003,15/12/2021`,
  `CDG-005,Nour Trabelsi,nour.trabelsi@${domain},Chief People Officer,People,CDG-001,01/06/2019`,
  `CDG-006,Hiba Messaoudi,hiba.messaoudi@${domain},Customer Success Manager,People,CDG-005,03/03/2023`,
].join("\n");
const form = new FormData();
form.append("files", new Blob([people]), "people.csv");
form.append("companyName", company);
const started = await fetch(`${BASE}/api/corehr/imports`, { method: "POST", headers: { Authorization: `Bearer ${amira}` }, body: form });
let session = (await started.json())?.data;
check("Home's drop starts an import", started.status === 200 && Boolean(session?.id), `${started.status}`);
for (let round = 0; round < 6 && session && !session.canBringIn; round++) {
  const open = [...session.checks.filter((c) => c.answer == null).map((c) => [c.key, (c.options.find((o) => o.lean) ?? c.options[0])?.key]),
    ...session.questions.map((q) => [q.key, q.lean])];
  for (const [key, value] of open) {
    const answered = await versioned(amira, "PUT", `/api/corehr/imports/${session.id}/answers`, session.version, { key, value });
    session = data(answered) ?? session;
  }
}
check("The import can be brought in", session?.canBringIn, `${session?.openCount} open`);
const asked = await versioned(amira, "POST", `/api/corehr/imports/${session.id}/bring-in`, session.version, { fingerprint: session.fingerprint });
session = data(asked);
for (let i = 0; session?.status === "BringingIn" && i < 120; i++) {
  await sleep(400);
  session = data(await call("GET", `/api/corehr/imports/${session.id}`, null, amira));
}
check("It's brought in", session?.status === "BroughtIn", session?.status);
g = await guide(amira);
check("Guide: six people, Amira matched by email and not doubled", g.people === 6, JSON.stringify(g));
const after = data(await call("GET", "/api/corehr/organization/readiness", null, amira));
check("The day-one root opens when the company's history starts", after?.permanentRootFirstEffectiveDate === "2017-05-07", after?.permanentRootFirstEffectiveDate);
const amiraRows = data(await call("GET", `/api/corehr/employees/people?q=${encodeURIComponent(adminEmail)}`, null, amira))?.items ?? [];
check("Amira is one record, the one her account opens", amiraRows.length === 1 && amiraRows[0].employeeKey === data(made)?.employeeKey);

const sami = data(await call("GET", `/api/corehr/employees/people?q=${encodeURIComponent(`sami.benyoussef@${domain}`)}`, null, amira))?.items?.[0];
const sent = await call("POST", "/api/corehr/employees/people/invitations", { audience: "Chosen", employeeIds: [sami.employeeId] }, amira);
check("Amira invites Sami", sent.status === 200 && data(sent)?.invited === 1, JSON.stringify(data(sent)));
g = await guide(amira);
check("Guide: the invite step is done", g.invited >= 1, JSON.stringify(g));
check("Carthage's administrator can't invite this company's people",
  data(await call("POST", "/api/corehr/employees/people/invitations", { audience: "Chosen", employeeIds: [sami.employeeId] }, carthage))?.invited !== 1);

const invitation = await inviteToken(`sami.benyoussef@${domain}`);
const accepted = await fetch(`${BASE}/api/identity/invites/${encodeURIComponent(invitation.token)}/accept`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ firstName: "Sami", lastName: "Ben Youssef", password: PASSWORD }),
});
check("Sami accepts", accepted.ok, `${accepted.status}`);
const samiToken = await login(`sami.benyoussef@${domain}`);
check("Sami's Home: his card", data(await call("GET", "/api/corehr/me/card", null, samiToken))?.displayName === "Sami Ben Youssef");
const mine = await call("GET", "/api/corehr/me/checklists", null, samiToken);
check("Sami's Home: his own checklists answer", mine.status === 200 && Array.isArray(data(mine)), `${mine.status}`);
const upcoming = await call("GET", "/api/corehr/upcoming?days=14", null, samiToken);
check("Sami's Home: Coming up answers", upcoming.status === 200, `${upcoming.status}`);
check("Sami can't make himself a first person", [403, 409].includes((await call("POST", "/api/corehr/me/first-person", yes, samiToken)).status));
const theirs = data(await call("GET", "/api/corehr/me/checklists", null, carthage)) ?? [];
check("Another company's checklists never include this company's", theirs.every((list) => !JSON.stringify(list).includes(company)));
g = await guide(amira);
check("Guide: Sami signed in counts", g.signedIn >= 2, JSON.stringify(g));

console.log(`\nCompany: ${company}  administrator: ${adminEmail}`);
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
