// B-247/B-248: shell-only authorization journey and repeatable joiner fixture.
// Saves/restores Carthage's work week; creates one fictional ordinary joiner through hire/invite/accept.
const path = require("path");
const fs = require("fs");
const { call, login, inviteToken, PASSWORD, BASE } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));
const fixture = path.join(__dirname, "b247-b248.local.json");
const data = (r) => r.json?.data;
const results = [];
function check(label, ok) { results.push(Boolean(ok)); console.log(`${ok ? "PASS" : "FAIL"} ${label}`); if (!ok) throw new Error(label); }
const claims = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
async function request(token, method, route, body, headers = {}) {
  const r = await fetch(`${BASE}${route}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json; try { json = await r.json(); } catch {} return { status: r.status, json };
}
(async () => {
  const hr = await login("amira.khelifi@example.test");
  const employee = await login("aicha.bouazizi@example.test");
  const other = await login("amira.khelifi@midyear-5.example.test");
  const ownTenant = data(await call("GET", "/api/identity/tenant-context/tenant-summary", null, hr)).tenantId;
  const foreignTenant = data(await call("GET", "/api/identity/tenant-context/tenant-summary", null, other)).tenantId;
  const employeeContext = data(await call("GET", "/api/corehr/workforce/me", null, employee)).employee;
  const foreignContext = data(await call("GET", "/api/corehr/workforce/me", null, other)).employee;
  const week = "/api/corehr/settings/work-week"; const settings = "/api/corehr/settings/organization"; const manager = "/api/corehr/me/manager";
  check("Signed-out work-week read refused", (await call("GET", week)).status === 401);
  check("Signed-out settings save refused", (await call("PATCH", settings, { workingDays: [1] })).status === 401);
  check("Signed-out manager read refused", (await call("GET", manager)).status === 401);
  const initial = data(await call("GET", settings, null, hr));
  const provisioningBefore = data(await call("GET", "/api/corehr/settings/provisioning", null, hr)).provisioning;
  const foreignBefore = data(await call("GET", week, null, other));
  check("Employee reads only working days", Object.keys(data(await call("GET", week, null, employee))).join() === "workingDays");
  check("Employee cannot read company administration", (await call("GET", settings, null, employee)).status === 403);
  check("Employee cannot save work week", (await call("PATCH", settings, { workingDays: [7] }, employee)).status === 403);
  check("Employee cannot bypass via general settings", (await call("PATCH", "/api/corehr/settings", { workingDays: [7] }, employee)).status === 403);
  const versioned = async (body, version, token = hr, headers = {}) => request(token, "PATCH", settings, body, { ...(version != null ? { "If-Match": `"${version}"` } : {}), ...headers });
  let edited = false;
  try {
    for (const days of [[], [0], [8], [1, 1]]) check(`Invalid days ${JSON.stringify(days)} refused`, (await versioned({ workingDays: days }, initial.version)).status === 400);
    const saved = await versioned({ workingDays: [7, 1, 3], tenantId: foreignTenant }, initial.version, hr, { "X-Tenant-Id": foreignTenant });
    edited = saved.status === 200;
    check("Administrator saves only their company despite forged tenant selectors", edited && data(saved).workingDays.join() === "1,3,7");
    check("Employee Home reads saved company days", data(await call("GET", week, null, employee)).workingDays.join() === "1,3,7");
    check("Missing version is refused", (await versioned({ workingDays: [1] }, null)).status === 409);
    check("Stale version is refused", (await versioned({ workingDays: [1] }, initial.version)).status === 409);
    check("Another tenant reads its own work week despite forged tenant header/query", JSON.stringify(data(await request(other, "GET", `${week}?tenantId=${ownTenant}`, null, { "X-Tenant-Id": ownTenant }))) === JSON.stringify(foreignBefore));
    check("No tenant-targeted settings route exists", (await call("PATCH", `${settings}/${ownTenant}`, { workingDays: [1] }, other)).status === 404);
    check("Employee header spoof cannot authorize company save", (await versioned({ workingDays: [1], tenantId: foreignTenant }, data(saved).version, employee, { "X-Tenant-Id": foreignTenant })).status === 403);
    check("Other company's settings stay unchanged", JSON.stringify(data(await call("GET", week, null, other))) === JSON.stringify(foreignBefore));
  } finally {
    if (edited) {
      const current = data(await call("GET", settings, null, hr));
      check("Restored initial work week", (await versioned({ workingDays: initial.workingDays }, current.version)).status === 200);
    }
  }
  check("Invitation defaults are unchanged by work-week saves", JSON.stringify(data(await call("GET", "/api/corehr/settings/provisioning", null, hr)).provisioning) === JSON.stringify(provisioningBefore));
  const self = await call("GET", manager, null, employee);
  check("Ordinary employee reads own current manager", self.status === 200 && data(self).manager?.displayName === employeeContext.manager?.displayName);
  check("Self read returns only surface data", Object.keys(data(self)).sort().join() === "isFirstWeek,manager" && Object.keys(data(self).manager ?? {}).sort().join() === "displayName,jobTitle");
  check("Another person query cannot select a subject", JSON.stringify(data(await call("GET", `${manager}?employeeId=${foreignContext.employeeId}`, null, employee))) === JSON.stringify(data(self)));
  check("Foreign tenant header cannot change self read", JSON.stringify(data(await request(employee, "GET", `${manager}?tenantId=${foreignTenant}`, null, { "X-Tenant-Id": foreignTenant }))) === JSON.stringify(data(self)));
  check("Request dates cannot override the server current manager", JSON.stringify(data(await call("GET", `${manager}?asOf=2099-01-01`, null, employee))) === JSON.stringify(data(self)));
  check("No person-targeted manager route exists", (await call("GET", `${manager}/${foreignContext.employeeId}`, null, employee)).status === 404);
  const ownOther = data(await call("GET", manager, null, other));
  check("Other tenant cannot select Carthage's employee", JSON.stringify(data(await request(other, "GET", `${manager}?employeeId=${employeeContext.employeeId}`, null, { "X-Tenant-Id": ownTenant }))) === JSON.stringify(ownOther));
  let demo = fs.existsSync(fixture) ? JSON.parse(fs.readFileSync(fixture)) : null;
  if (!demo) {
    const mariam = data(await call("GET", "/api/corehr/workforce/me", null, await login("mariam.gharbi@example.test"))).employee;
    const jobs = data(await call("GET", "/api/corehr/catalog/jobs", null, hr));
    const email = `ons.b248.${Date.now().toString(36)}@example.test`;
    const hire = await call("POST", "/api/corehr/employees/hire", { firstName: "Ons", lastName: "Khemiri", workEmail: email,
      employeeNumberMode: "Generated", startDate: `${new Date().toISOString().slice(0, 10)}T00:00:00Z`, orgUnitId: mariam.orgUnit.orgUnitId,
      jobId: jobs.find(j => !j.isRetired && j.peopleCount > 0).id, primaryManagerEmployeeId: mariam.employeeId }, hr);
    check("Created fictional joiner through hire", hire.status === 201);
    const person = data(await call("GET", `/api/corehr/employees/people?q=${encodeURIComponent(email)}`, null, hr)).items.find(p => p.workEmail === email);
    demo = { email, employeeKey: person.employeeKey, employeeId: person.employeeId, activated: false };
    fs.writeFileSync(fixture, JSON.stringify(demo, null, 2));
  }
  if (!demo.activated) {
    const sent = await call("POST", "/api/corehr/employees/people/invitations", { audience: "Chosen", employeeIds: [demo.employeeId] }, hr);
    check("Joiner invited through existing flow", sent.status === 200);
    const invitation = await inviteToken(demo.email);
    check("Joiner accepts invitation", (await call("POST", `/api/identity/invites/${encodeURIComponent(invitation.token)}/accept`, { firstName: "Ons", lastName: "Khemiri", password: PASSWORD }, null)).status === 201);
    demo.activated = true;
    fs.writeFileSync(fixture, JSON.stringify(demo, null, 2));
  }
  const joiner = await login(demo.email);
  check("Joiner has no manager or workforce administration grant", ![claims(joiner).core_permission ?? []].flat().some(p => /^(core\.team\.|core\.employee\.manage|settings\.)/.test(String(p)) || (String(p).startsWith("core.employee.view|") && !String(p).endsWith("|Self"))));
  const home = await call("GET", manager, null, joiner);
  check("Joiner Home has canonical manager and first-week flag", home.status === 200 && data(home).isFirstWeek && data(home).manager?.displayName === "Mariam Gharbi");
  console.log(`Review joiner: ${demo.email}`);
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => console.log(`Passed ${results.filter(Boolean).length} | Failed ${results.filter(r => !r).length} | Skipped 0`));
