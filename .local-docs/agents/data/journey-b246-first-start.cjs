// B-246 through the shell. Creates two fictional companies: one open review and one published historical import.
// No existing tenant is changed. Credentials stay in memory; review identifiers are kept in b246.local.json.
const fs = require("node:fs/promises");
const path = require("node:path");
const { BASE, MAILPIT, PASSWORD, call, login } = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");
let passed = 0;
function check(name, condition) {
  if (!condition) throw new Error(`FAIL ${name}`);
  passed++;
  console.log(`PASS ${name}`);
}
const data = (response) => response.json?.data;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function versioned(token, session, suffix, body, method = "PUT", version = session.version) {
  const response = await fetch(`${BASE}/api/corehr/imports/${session.id}/${suffix}`, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), "If-Match": `"${version}"` },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, json };
}
async function company(platform, label) {
  const stamp = `${Date.now().toString(36)}-${label.toLowerCase()}`;
  const name = `First Start ${label}`;
  const domain = `first-start-${stamp}.example.test`;
  const admin = `amira.khelifi@${domain}`;
  const made = await call("POST", "/api/identity/platform-admin/tenants", {
    name: `${name} ${stamp}`, locale: "en-US", timeZone: "Africa/Tunis", industry: "Technology", modules: ["Performance"],
    administratorEmail: admin, administratorFirstName: "Amira", administratorLastName: "Khelifi", idempotencyKey: `b246-${stamp}`,
  }, platform);
  check(`${label}: fictional tenant provisioned`, made.status === 201 || made.status === 200);
  let credential;
  for (let i = 0; i < 30 && !credential; i++) {
    const messages = await (await fetch(`${MAILPIT}/api/v1/search?query=to:${encodeURIComponent(admin)}`)).json();
    if (messages.messages?.[0]) {
      const mail = await (await fetch(`${MAILPIT}/api/v1/message/${messages.messages[0].ID}`)).json();
      credential = `${mail.Text}\n${mail.HTML}`.match(/[?&]credential=([^&"'<>\s]+)/)?.[1];
    }
    if (!credential) await pause(500);
  }
  if (!credential) throw new Error("Activation invitation did not arrive");
  const activated = await call("POST", "/api/identity/tenant-activation", {
    credential: decodeURIComponent(credential), password: PASSWORD, firstName: "Amira", lastName: "Khelifi",
  });
  check(`${label}: administrator activated`, activated.status === 200);
  let token = await login(admin);
  const first = await call("POST", "/api/corehr/me/first-person", {
    firstName: "Amira", lastName: "Khelifi", jobTitle: "Director", companyName: name,
  }, token);
  check(`${label}: activation-created person linked`, first.status === 200 && data(first)?.linked);
  token = await login(admin);
  const csv = `Name,Email,Title,Department,Manager,Start date\nAmira Khelifi,${admin},Director,${name},,2020-01-02\nNour Trabelsi,nour@${domain},Engineer,${name},${admin},2021-02-03\n`;
  const form = new FormData();
  form.append("files", new Blob([csv], { type: "text/csv" }), "people.csv");
  form.append("companyName", name);
  const response = await fetch(`${BASE}/api/corehr/imports`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  let session = (await response.json()).data;
  check(`${label}: file matches the first person`, response.status === 200 && session.again?.new.length === 1);
  session = data(await versioned(token, session, "leans", {}, "POST"));
  check(`${label}: keep is the default after taking leans`, session.checks.find((check) => check.kind === "firstPersonStart")?.answer === "keep");
  return { name, domain, admin, token, session, employeeKey: data(first).employeeKey };
}
async function choose(fixture, value) {
  const key = fixture.session.checks.find((check) => check.kind === "firstPersonStart").key;
  const response = await versioned(fixture.token, fixture.session, "answers", { key, value });
  check(`Review choice ${value} saved`, response.status === 200);
  fixture.session = data(response);
}
async function main() {
  const platform = await login("admin@ey-hr.com");
  const fixturePath = path.join(__dirname, "b246.local.json");
  const existing = process.argv.includes("--resume") ? JSON.parse(await fs.readFile(fixturePath, "utf8")) : null;
  const review = existing ? { ...existing, token: await login(existing.admin) } : await company(platform, "Review");
  if (existing) review.session = data(await call("GET", `/api/corehr/imports/${existing.session}`, null, review.token));
  await fs.writeFile(fixturePath, JSON.stringify({ admin: review.admin, session: review.session.id,
    employeeKey: review.employeeKey, name: review.name, domain: review.domain }, null, 2));
  const other = await login("amira.khelifi@example.test");
  const employee = await login("aicha.bouazizi@example.test");
  const key = review.session.checks.find((check) => check.kind === "firstPersonStart").key;
  check("Anonymous choice refused", (await versioned(null, review.session, "answers", { key, value: "file" })).status === 401);
  check("Employee cannot choose an import date", (await versioned(employee, review.session, "answers", { key, value: "file" })).status === 403);
  check("Employee cannot publish the correction", (await versioned(employee, review.session, "bring-in", { fingerprint: review.session.fingerprint }, "POST")).status === 403);
  check("Other tenant cannot read the review", (await call("GET", `/api/corehr/imports/${review.session.id}`, null, other)).status === 404);
  check("Other tenant cannot choose the date", (await versioned(other, review.session, "answers", { key, value: "file" })).status === 404);
  check("Other tenant cannot publish", (await versioned(other, review.session, "bring-in", { fingerprint: review.session.fingerprint }, "POST")).status === 404);
  check("Arbitrary date cannot replace a bounded choice", (await versioned(review.token, review.session, "answers", { key, value: "2010-01-01" })).status === 422);
  const staleVersion = review.session.version;
  await choose(review, "file");
  check("The chosen date is listed with old and new values", review.session.again.changed.some((person) => person.changes.some((change) => change.field === "startDate" && change.to === "2020-01-02")));
  check("Stale review version cannot change the choice", (await versioned(review.token, review.session, "answers", { key, value: "keep" }, "PUT", staleVersion)).status === 409);
  await choose(review, "keep");
  check("Keeping removes the proposed start correction", !review.session.again.changed.some((person) => person.changes.some((change) => change.field === "startDate")));
  await choose(review, "file");

  const publishedPath = path.join(__dirname, "b246-published.local.json");
  const savedPublished = process.argv.includes("--resume")
    ? await fs.readFile(publishedPath, "utf8").then(JSON.parse).catch((error) => { if (error.code === "ENOENT") return null; throw error; }) : null;
  const publish = savedPublished ? { ...savedPublished, token: await login(savedPublished.admin) } : await company(platform, "Published");
  if (savedPublished) publish.session = data(await call("GET", `/api/corehr/imports/${savedPublished.session}`, null, publish.token));
  else {
    await fs.writeFile(publishedPath, JSON.stringify({ admin: publish.admin, session: publish.session.id,
      employeeKey: publish.employeeKey, name: publish.name, domain: publish.domain }, null, 2));
  }
  if (publish.session.status === "Open") {
    await choose(publish, "file");
    const requested = await versioned(publish.token, publish.session, "bring-in", { fingerprint: publish.session.fingerprint }, "POST");
    check("Reviewed correction accepted for publication", requested.status === 200);
    publish.session = data(requested);
  }
  for (let i = 0; publish.session.status === "BringingIn" && i < 120; i++) {
    await pause(500);
    publish.session = data(await call("GET", `/api/corehr/imports/${publish.session.id}`, null, publish.token));
  }
  check("Historical import completes", publish.session.status === "BroughtIn");
  const people = data(await call("GET", "/api/corehr/employees/people?pageSize=20", null, publish.token));
  const first = people.items.find((person) => person.employeeKey === publish.employeeKey);
  check("First person matched once; employment and original job start together", people.totalCount === 2 && first.employmentStart.startsWith("2020-01-02") && first.work.effectiveFrom.startsWith("2020-01-02"));
  const report = people.items.find((person) => person.workEmail === `nour@${publish.domain}`);
  const datedResponse = await call("GET", `/api/corehr/employees/people/${report.employeeKey}?asOf=2021-02-03`, null, publish.token);
  if (datedResponse.status !== 200) throw new Error(`Dated profile: ${datedResponse.status} ${JSON.stringify(datedResponse.json)}`);
  const dated = data(datedResponse);
  if (dated?.primaryManager?.employeeKey !== publish.employeeKey)
    console.error(`Dated manager: ${dated?.primaryManager?.employeeKey ?? "none"}; expected ${publish.employeeKey}`);
  check("Dated report resolves the administrator before activation", dated?.primaryManager?.employeeKey === publish.employeeKey);
  check("Completed import cannot be resumed into another correction", (await versioned(publish.token, publish.session, "resume", {}, "POST")).status === 409);
  console.log(`B-246 API | Passed ${passed} | Failed 0 | Skipped 0`);
}
main().catch((error) => { console.error(error.message); console.error(`B-246 API | Passed ${passed} | Failed 1 | Skipped 0`); process.exitCode = 1; });
