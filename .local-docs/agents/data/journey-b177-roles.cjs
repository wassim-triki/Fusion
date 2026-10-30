// B-177 API journey, through the shell like the browser:
//   node .local-docs/agents/data/journey-b177-roles.cjs [--keep]
// In Carthage Digital Group, Amira (tenant administrator) reads every role (ten areas; Employees held by everyone,
// Managers by anyone with a team), creates "Payroll desk", gives it Jobs for everyone and a rule on Leila's job,
// and sees Leila among its holders, with why on her Access tab and the grant in her access. Core HR then changes
// Leila's job: the rule lets her go on its own; cancelling the change brings her back. Mariam (manager) and Leila
// (employee) can't read or change roles; another company's unit, an unknown value, an administrators-only area and a
// stale version are refused; Amira can't change the Administrators role. Ends by deleting the role, unless --keep.
const path = require("path");
const { call, login } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const keep = process.argv.includes("--keep");
const data = (r) => r.json?.data;
const results = [];
function check(label, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  return ok;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const today = new Date().toISOString().slice(0, 10);

async function until(probe, tries = 20) {
  for (let i = 0; i < tries; i++) {
    if (await probe()) return true;
    await sleep(1500);
  }
  return false;
}

(async () => {
  const amira = await login("amira.khelifi@example.test");
  const mariam = await login("mariam.gharbi@example.test");
  const leila = await login("leila.baccouche@example.test");

  // A role left by an interrupted run goes first.
  for (const stale of data(await call("GET", "/api/identity/core-access/roles", null, amira))?.roles ?? []) {
    if (stale.name.startsWith("Payroll desk")) await call("DELETE", `/api/identity/core-access/roles/${stale.id}`, null, amira);
  }

  // Every role, one table.
  const overview = data(await call("GET", "/api/identity/core-access/roles", null, amira));
  check("Amira reads every role", overview?.roles?.length >= 4, `${overview?.roles?.length} roles`);
  check("ten areas", overview?.areas?.length === 10, overview?.areas?.map((area) => area.id).join(","));
  const byKind = (kind) => overview.roles.find((role) => role.holderKind === kind && role.isBuiltIn);
  check("Employees are everyone", byKind("everyone")?.name === "Employees", `${byKind("everyone")?.holderCount} people`);
  check("Managers are anyone with a team", byKind("team")?.name === "Managers", `${byKind("team")?.holderCount} people`);

  // Who can read and change roles.
  check("Mariam (manager) can't read roles", (await call("GET", "/api/identity/core-access/roles", null, mariam)).status === 403);
  check("Leila (employee) can't read roles", (await call("GET", "/api/identity/core-access/roles", null, leila)).status === 403);
  check("Leila can't create a role", (await call("POST", "/api/identity/core-access/roles", { name: "Mine" }, leila)).status === 403);

  // Leila: her record, her job.
  const people = data(await call("GET", "/api/corehr/employees/people?q=Leila&pageSize=5", null, amira));
  const row = people?.items?.find((item) => item.displayName.startsWith("Leila"));
  const profile = data(await call("GET", `/api/corehr/employees/people/${row.employeeKey}`, null, amira));
  const leilaId = profile.identity.employeeId;
  const leilaJob = profile.work?.jobId;
  check("Leila has a job from the catalogue", Boolean(leilaJob), row.work?.jobTitle);

  // A role by rule.
  const created = await call("POST", "/api/identity/core-access/roles", { name: "Payroll desk" }, amira);
  check("Amira creates a role", created.status === 201, created.status);
  let role = data(created);
  const put = (body, version) =>
    fetch(`http://localhost:3000/api/identity/core-access/roles/${role.role.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${amira}`, "If-Match": `"${version ?? role.role.version}"` },
      body: JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  const rule = (conditions, cells = [{ areaId: "job", level: "see", reach: "everyone" }]) => ({
    name: role.role.name, description: null, cells, holderKind: "rule", conditions, chosenUserIds: [],
  });

  const saved = await put(rule([{ kind: "job", targetId: leilaJob }]));
  check("Amira saves Jobs for everyone and a rule on Leila's job", saved.status === 200, saved.status);
  role = data(saved);
  const personal = role.role.cells.find((cell) => cell.areaId === "personal");
  check("Personal details move with Jobs (one record)", personal?.level === "see" && personal?.reach === "everyone", JSON.stringify(personal));
  check("Leila holds it by the rule", role.holders.some((holder) => holder.employeeId === leilaId && holder.byRule && !holder.isChosen));

  const why = data(await call("GET", `/api/identity/core-access/people/${leilaId}/roles`, null, amira));
  const mine = why?.find((item) => item.roleId === role.role.id);
  check("Leila's Access tab says why: her job", mine?.reasons?.[0]?.kind === "rule" && mine.reasons[0].conditions[0]?.targetId === leilaJob);
  check("and Employees because everyone has it", why?.some((item) => item.name === "Employees" && item.reasons[0]?.kind === "everyone"));
  check("Leila reads her own roles", (await call("GET", `/api/identity/core-access/people/${leilaId}/roles`, null, leila)).status === 200);
  const mariamRow = data(await call("GET", "/api/corehr/employees/people?q=Mariam&pageSize=5", null, amira))?.items?.[0];
  const mariamId = data(await call("GET", `/api/corehr/employees/people/${mariamRow.employeeKey}`, null, amira))?.identity?.employeeId;
  check("Leila can't read Mariam's roles", (await call("GET", `/api/identity/core-access/people/${mariamId}/roles`, null, leila)).status === 403);
  const access = data(await call("GET", "/api/identity/core-access/me", null, leila));
  check("Leila's access now covers everyone's jobs", access?.effectivePermissions?.some((grant) => grant.permissionKey === "core.employee.view" && grant.scope === "Tenant"));

  // Refusals.
  // Another company: the Mid-year preset (its administrator's address carries the preset's build number).
  const elsewhere = await login(process.env.B177_OTHER ?? "amira.khelifi@midyear-5.example.test");
  const foreignRoot = data(await call("GET", `/api/corehr/organization/hierarchy?asOf=${today}`, null, elsewhere))?.roots?.[0]?.unit?.id;
  check("another company's unit is refused", Boolean(foreignRoot) && (await put(rule([{ kind: "unit", targetId: foreignRoot }]))).status === 400);
  check("another company's administrator can't open this role",
    (await call("GET", `/api/identity/core-access/roles/${role.role.id}`, null, elsewhere)).status === 404);
  check("an unknown value is refused", (await put(rule([{ kind: "place", targetId: "00000000-0000-0000-0000-00000000abcd" }]))).status === 400);
  check("an administrators-only area is refused",
    (await put(rule([{ kind: "job", targetId: leilaJob }], [{ areaId: "roles", level: "change", reach: null }]))).status === 400);
  check("a stale version is refused", (await put(rule([{ kind: "job", targetId: leilaJob }]), role.role.version + 7)).status === 409);
  const admins = overview.roles.find((item) => item.isAdministrators);
  const adminSave = await fetch(`http://localhost:3000/api/identity/core-access/roles/${admins.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${amira}`, "If-Match": `"${admins.version}"` },
    body: JSON.stringify({ name: "Administrators", description: null, cells: [], holderKind: "everyone", conditions: [], chosenUserIds: [] }),
  });
  check("the Administrators role can't be changed here", adminSave.status === 400, adminSave.status);
  check("Mariam can't save the role", (await fetch(`http://localhost:3000/api/identity/core-access/roles/${role.role.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${mariam}`, "If-Match": `"${role.role.version}"` },
    body: JSON.stringify(rule([{ kind: "job", targetId: leilaJob }])),
  })).status === 403);

  // Core HR changes Leila's job: the rule follows on its own.
  const jobs = data(await call("GET", "/api/corehr/catalog/jobs", null, amira));
  const other = jobs?.find((job) => job.id !== leilaJob && !job.isRetired);
  const change = await call("POST", `/api/corehr/employees/people/${row.employeeKey}/changes/job`, { effectiveDate: today, jobId: other.id }, amira);
  check("Core HR changes Leila's job today", change.status === 200, `${change.status} → ${other.title}`);
  const changeId = data(change)?.changeId ?? data(change)?.id ?? data(change)?.change?.id;
  const holds = async () => data(await call("GET", `/api/identity/core-access/roles/${role.role.id}`, null, amira))?.holders?.some((holder) => holder.employeeId === leilaId);
  check("the rule lets Leila go on its own", await until(async () => !(await holds())));
  if (changeId) {
    const cancelled = await call("POST", `/api/corehr/employees/people/changes/${changeId}/cancel`, {}, amira);
    check("cancelling the change", cancelled.status === 204, cancelled.status);
    check("brings Leila back", await until(holds));
  } else {
    check("the change returned its id to cancel", false, JSON.stringify(data(change)).slice(0, 200));
  }

  if (!keep) {
    const removed = await call("DELETE", `/api/identity/core-access/roles/${role.role.id}`, null, amira);
    check("Amira deletes the role", removed.status === 204, removed.status);
    const after = data(await call("GET", "/api/identity/core-access/me", null, leila));
    check("Leila no longer covers everyone's jobs", !after?.effectivePermissions?.some((grant) => grant.permissionKey === "core.employee.view" && grant.scope === "Tenant"));
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
