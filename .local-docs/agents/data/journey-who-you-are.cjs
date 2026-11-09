// Session 1 after the walkthrough (B-391, B-399, B-400, B-401), through the shell API only. Creates one fictional
// company like the walkthrough's ("Who You Are <stamp>"), brings in the walkthrough's two import files, then checks:
// the administrator's day-one record takes her file number and job and every line to or from her holds today (B-391);
// one administrator can run the company and the last can't go (B-399); a change to your own roles keeps you signed in
// after one refresh (B-399). No existing tenant is changed.
// node .local-docs/agents/data/journey-who-you-are.cjs
const path = require("node:path");
const fs = require("node:fs/promises");
const { execFileSync } = require("node:child_process");
const { BASE, MAILPIT, PASSWORD, call, login, inviteToken } = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");

let passed = 0;
function check(name, condition, detail) {
  if (!condition) throw new Error(`FAIL ${name}${detail ? ` (${detail})` : ""}`);
  passed++;
  console.log(`PASS ${name}`);
}
const data = (response) => response.json?.data;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The import moves the administrator's own authority (she becomes a manager), which turns her token away as
// revision-stale; the browser refreshes once and retries, and so does this journey.
const admin = { email: null, token: null, refreshToken: null };
async function signIn() {
  const r = data(await call("POST", "/api/identity/auth/login", { email: admin.email, password: PASSWORD }));
  admin.token = r.accessToken;
  admin.refreshToken = r.refreshToken;
}
async function asAdmin(request) {
  const first = await request(admin.token);
  if (first.status !== 401 || first.json?.reason !== "revision-stale") return first;
  const r = await call("POST", "/api/identity/auth/refresh", { refreshToken: admin.refreshToken });
  if (r.status !== 200) throw new Error(`Refresh after a stale revision: ${r.status}`);
  admin.token = data(r).accessToken;
  admin.refreshToken = data(r).refreshToken;
  return request(admin.token);
}
async function versioned(token, session, suffix, body, method = "PUT") {
  const response = await fetch(`${BASE}/api/corehr/imports/${session.id}/${suffix}`, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "If-Match": `"${session.version}"` },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}
async function credentialFor(email) {
  for (let i = 0; i < 30; i++) {
    const messages = await (await fetch(`${MAILPIT}/api/v1/search?query=to:${encodeURIComponent(email)}`)).json();
    if (messages.messages?.[0]) {
      const mail = await (await fetch(`${MAILPIT}/api/v1/message/${messages.messages[0].ID}`)).json();
      const credential = `${mail.Text}\n${mail.HTML}`.match(/[?&]credential=([^&"'<>\s]+)/)?.[1];
      if (credential) return decodeURIComponent(credential);
    }
    await pause(500);
  }
  throw new Error(`No activation mail for ${email}`);
}
async function everyone() {
  const all = [];
  for (let page = 1; ; page++) {
    const r = data(await asAdmin((token) => call("GET", `/api/corehr/employees/people?pageSize=100&page=${page}`, null, token)));
    all.push(...r.items);
    if (page >= r.totalPages) return all;
  }
}
async function roleNamed(name) {
  const overview = data(await asAdmin((token) => call("GET", "/api/identity/core-access/roles", null, token)));
  const role = overview.roles.find((item) => item.isBuiltIn && item.name === name);
  return data(await asAdmin((token) => call("GET", `/api/identity/core-access/roles/${role.id}`, null, token)));
}

async function main() {
  const platform = await login("admin@ey-hr.com");
  const stamp = Date.now().toString(36);
  const domain = `who-you-are-${stamp}.example.test`;
  const company = `Who You Are ${stamp}`;
  admin.email = `amira.khelifi@${domain}`;

  // ── Day one, like the walkthrough ──
  const made = await call("POST", "/api/identity/platform-admin/tenants", {
    name: company, locale: "en-US", timeZone: "Africa/Tunis", industry: "Technology", modules: ["Performance"],
    administratorEmail: admin.email, administratorFirstName: "Amira", administratorLastName: "Khelifi", idempotencyKey: `who-${stamp}`,
  }, platform);
  check("Fictional company provisioned", [200, 201].includes(made.status), made.status);
  const activated = await call("POST", "/api/identity/tenant-activation", {
    credential: await credentialFor(admin.email), password: PASSWORD, firstName: "Amira", lastName: "Khelifi",
  });
  check("Amira, the administrator, activates", activated.status === 200, activated.status);
  await signIn();
  const first = await call("POST", "/api/corehr/me/first-person", { firstName: "Amira", lastName: "Khelifi", jobTitle: "Director", companyName: company }, admin.token);
  check("She answers yes to 'Do you work here?' with a placeholder job", first.status === 200 && data(first)?.linked);
  await signIn();

  // ── B-391: the walkthrough's two files ──
  execFileSync(process.execPath, [path.join(__dirname, "make-walkthrough-import-files.mjs"), domain], { stdio: "ignore" });
  const dir = path.join(__dirname, "demo-presets", ".work", "walkthrough");
  const form = new FormData();
  for (const name of ["Carthage employees 2026.csv", "Carthage departments.csv"])
    form.append("files", new Blob([await fs.readFile(path.join(dir, name))], { type: "text/csv" }), name);
  form.append("companyName", company);
  const started = await fetch(`${BASE}/api/corehr/imports`, { method: "POST", headers: { Authorization: `Bearer ${admin.token}` }, body: form });
  let session = (await started.json()).data;
  check("The two files are read", started.status === 200 && Boolean(session?.id), started.status);
  session = data(await versioned(admin.token, session, "leans", {}, "POST"));
  const changed = session.again?.changed.find((person) => person.changes.some((change) => change.field === "employeeNumber"));
  check("Review lists her file number as a change", changed?.changes.some((change) => change.field === "employeeNumber" && change.to === "CDG-002"),
    JSON.stringify(session.again?.changed?.[0]?.changes));
  check("Nothing left to answer", session.canBringIn, JSON.stringify(session.checks?.filter((item) => !item.answer).map((item) => item.kind)));
  const requested = await versioned(admin.token, session, "bring-in", { fingerprint: session.fingerprint }, "POST");
  check("Bring-in accepted", requested.status === 200, requested.status);
  session = data(requested);
  for (let i = 0; session.status === "BringingIn" && i < 240; i++) {
    await pause(1000);
    session = data(await asAdmin((token) => call("GET", `/api/corehr/imports/${session.id}`, null, token)));
  }
  check("Import brought in", session.status === "BroughtIn", session.status);

  const people = await everyone();
  const amira = people.find((person) => person.workEmail === admin.email);
  check("One Amira: day-one record and file row are one person", people.filter((person) => person.workEmail === admin.email).length === 1);
  check("She has the file's number", amira.employeeNumber === "CDG-002", amira.employeeNumber);
  check("Her file job holds from her day-one start, not tomorrow", amira.work?.jobTitle !== "Director"
    && amira.work?.effectiveFrom?.slice(0, 10) === amira.employmentStart?.slice(0, 10), `${amira.work?.jobTitle} ${amira.work?.effectiveFrom}`);
  check("She reports to Sami today", amira.primaryManager?.displayName?.startsWith("Sami"), amira.primaryManager?.displayName);
  const hers = people.filter((person) => person.primaryManager?.employeeKey === amira.employeeKey).map((person) => person.firstName).sort();
  check("Her six reports report to her today", ["Elyes", "Houssem", "Mariam", "Mouna", "Omar", "Rania"].every((name) => hers.includes(name)), hers.join(", "));
  const employedWithout = people.filter((person) => person.employmentState === "Active" && !person.primaryManager);
  check("Only the CEO has no manager", employedWithout.length === 1 && employedWithout[0].firstName === "Sami", employedWithout.map((person) => person.displayName).join(", "));

  // ── B-399: one administrator can run the company; the last can't go ──
  const other = await login("amira.khelifi@example.test");
  let admins = data(await asAdmin((token) => call("GET", "/api/identity/tenant-access/administrators", null, token)));
  const own = admins.find((item) => item.email === admin.email);
  check("Alone, she is held back with the reason", admins.length === 1 && own.blockedReason?.includes("at least one"), own?.blockedReason);
  const alone = await asAdmin((token) => call("POST", `/api/identity/tenant-access/administrators/${own.membershipId}/authority:revoke`, {}, token));
  check("The last administrator can't step down", alone.status === 409 || alone.status === 422, alone.status);
  check("Another company's administrator can't touch her", (await call("POST", `/api/identity/tenant-access/administrators/${own.membershipId}/authority:revoke`, {}, other)).status === 404);

  const mariam = people.find((person) => person.firstName === "Mariam" && person.lastName === "Gharbi");
  const invited = await asAdmin((token) => call("POST", "/api/corehr/employees/people/invitations", { audience: "Chosen", employeeIds: [mariam.employeeId] }, token));
  check("Mariam, a manager, is invited", invited.status === 200 && data(invited)?.invited === 1, invited.status);
  const accepted = await call("POST", `/api/identity/invites/${(await inviteToken(mariam.workEmail)).token}/accept`, { password: PASSWORD });
  check("and accepts", [200, 201].includes(accepted.status), accepted.status);
  const mariamToken = await login(mariam.workEmail);
  const mariamUser = data(await asAdmin((token) => call("GET", `/api/identity/tenant-access/administrators/candidates?search=Mariam`, null, token)))?.[0]?.userId;
  check("Mariam can't make herself an administrator", (await call("POST", "/api/identity/tenant-access/administrators", { userId: mariamUser, password: PASSWORD }, mariamToken)).status === 403);
  const added = await asAdmin((token) => call("POST", "/api/identity/tenant-access/administrators", { userId: mariamUser, password: PASSWORD }, token));
  check("Amira adds Mariam as a second administrator", added.status === 200 || added.status === 201, added.status);
  admins = data(await asAdmin((token) => call("GET", "/api/identity/tenant-access/administrators", null, token)));
  check("At two, neither is held back", admins.length === 2 && admins.every((item) => !item.blockedReason));
  const second = admins.find((item) => item.email === mariam.workEmail);
  const removed = await asAdmin((token) => call("POST", `/api/identity/tenant-access/administrators/${second.membershipId}/authority:revoke`, {}, token));
  check("Back to one administrator is allowed", removed.status === 200 || removed.status === 204, removed.status);
  check("and the last is held back again", (await asAdmin((token) => call("POST", `/api/identity/tenant-access/administrators/${own.membershipId}/authority:revoke`, {}, token))).status !== 200);
  check("Mariam, no longer an administrator, can't read them", (await call("GET", "/api/identity/tenant-access/administrators", null, await login(mariam.workEmail))).status === 403);

  // ── B-399: giving yourself a role keeps you signed in ──
  await signIn();
  const hr = await roleNamed("HR");
  const me = admins.find((item) => item.email === admin.email).userId;
  const before = { token: admin.token, refreshToken: admin.refreshToken };
  const saved = await fetch(`${BASE}/api/identity/core-access/roles/${hr.role.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${admin.token}`, "If-Match": `"${hr.role.version}"` },
    body: JSON.stringify({ name: hr.role.name, description: hr.role.description, cells: hr.role.cells, holderKind: hr.role.holderKind,
      conditions: hr.role.conditions, chosenUserIds: [me] }),
  });
  check("Amira gives herself HR", saved.status === 200, saved.status);
  let turnedAway = null;
  for (let i = 0; i < 10 && turnedAway?.status !== 401; i++) {
    turnedAway = await call("GET", "/api/corehr/workforce/me", null, before.token);
    if (turnedAway.status !== 401) await pause(1000);
  }
  check("Her old token is turned away as stale, not ended", turnedAway.status === 401 && turnedAway.json?.reason === "revision-stale", turnedAway.status);
  const refreshed = await call("POST", "/api/identity/auth/refresh", { refreshToken: before.refreshToken });
  check("One refresh brings the new authority", refreshed.status === 200 && Boolean(data(refreshed)?.accessToken), refreshed.status);
  check("A second refresh with the same token is refused (why the browser shares one)",
    (await call("POST", "/api/identity/auth/refresh", { refreshToken: before.refreshToken })).status === 401);
  check("The new session works", (await call("GET", "/api/corehr/workforce/me", null, data(refreshed).accessToken)).status === 200);

  console.log(`Company: ${company} (${admin.email})`);
  console.log(`Who you are API | Passed ${passed} | Failed 0 | Skipped 0`);
}
main().catch((error) => { console.error(error.message); console.error(`Who you are API | Passed ${passed} | Failed 1 | Skipped 0`); process.exitCode = 1; });
