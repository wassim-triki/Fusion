// Sets up the Reports demo and verifies viewer-scoped sharing through the shell.
// Keeps "Engineering by place" and Managers' Reports access for the review.
const { call, login } = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");
const assert = require("node:assert/strict");
const today = new Date().toISOString().slice(0, 10);
const data = response => response.json?.data;
let passed = 0;
function check(label, condition) { assert.ok(condition, label); passed++; console.log(`PASS ${label}`); }
async function ok(token, method, path, body) {
  const response = await call(method, path, body, token);
  assert.equal(response.status, 200, `${method} ${path}: ${response.status} ${JSON.stringify(response.json).slice(0, 200)}`);
  return data(response);
}
async function setReports(token, roleId, level, reach) {
  const detail = await ok(token, "GET", `/api/identity/core-access/roles/${roleId}`);
  const role = detail.role;
  const response = await fetch(`http://localhost:3000/api/identity/core-access/roles/${roleId}`, {
    method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "If-Match": `"${role.version}"` },
    body: JSON.stringify({ name: role.name, description: role.description, holderKind: role.holderKind, conditions: role.conditions,
      chosenUserIds: detail.holders.filter(h => h.isChosen).map(h => h.userId),
      cells: role.cells.map(c => c.areaId === "reports" ? { areaId: "reports", level, reach } : c) }),
  });
  assert.equal(response.status, 200, `set Reports on ${role.name}`);
}
(async () => {
  let hr = await login("amira.khelifi@example.test");
  const overview = await ok(hr, "GET", "/api/identity/core-access/roles");
  const managerRole = overview.roles.find(r => r.name === "Managers");
  check("Reports offers See and Build for team and company", overview.areas.find(a => a.id === "reports").options.length === 4);
  await setReports(hr, managerRole.id, "see", "team");
  hr = await login("amira.khelifi@example.test");
  const manager = await login("mariam.gharbi@example.test");
  const employee = await login("leila.baccouche@example.test");
  const elsewhere = await login(process.env.B189_OTHER ?? "amira.khelifi@midyear-5.example.test");
  const definition = { measure: "headcount", groupBy: "place", mode: "range", from: `${Number(today.slice(0,4))-7}-01-01`, to: today,
    interval: "year", filters: [], fields: ["name", "job", "place"] };
  const existing = await ok(hr, "GET", "/api/corehr/reports");
  let report = existing.find(r => r.name === "Engineering by place");
  const roles = await ok(hr, "GET", "/api/corehr/reports/roles");
  const chart = await ok(hr, "GET", `/api/corehr/org-chart?asOf=${today}`);
  const division = chart.people?.find(p => p.unit?.divisionName?.includes("Engineering"))?.unit?.divisionName;
  if (division) definition.filters = [{ field: "division", values: [division] }];
  report = await ok(hr, report ? "PUT" : "POST", report ? `/api/corehr/reports/${report.id}` : "/api/corehr/reports", { name: "Engineering by place", definition });
  check("HR saves a company report", !!report.id && report.canEdit);
  await ok(hr, "PUT", `/api/corehr/reports/${report.id}/share`, { roleIds: [managerRole.id] });
  const shared = await ok(manager, "GET", `/api/corehr/reports/${report.id}`);
  check("manager opens the shared report as a viewer", !shared.canEdit);
  check("shared report appears in the manager's list", (await ok(manager, "GET", "/api/corehr/reports")).some(r => r.id === report.id));
  const whole = await ok(hr, "POST", "/api/corehr/reports/run", definition);
  const part = await ok(manager, "POST", "/api/corehr/reports/run", shared.definition);
  check("manager sees fewer people than HR", part.totals.at(-1) > 0 && part.totals.at(-1) < whole.totals.at(-1));
  const team = await ok(manager, "GET", "/api/corehr/me/team");
  check("manager has a real team", team.members.length > 0);
  // The manager's Reports reach is the entire branch; check direct people plus their nested branch from the dated chart.
  const managerKey = chart.people.find(p => p.displayName.includes("Mariam Gharbi"))?.employeeKey;
  const branch = new Set(); const queue = [managerKey];
  while (queue.length) { const parent = queue.shift(); for (const p of chart.people.filter(p => p.managerKey === parent)) if (!branch.has(p.employeeKey)) { branch.add(p.employeeKey); queue.push(p.employeeKey); } }
  check("every returned person is in the manager's branch", part.people.length > 0 && part.people.every(p => branch.has(p.employeeKey)));
  for (const format of ["csv", "xlsx"]) {
    const response = await fetch(`http://localhost:3000/api/corehr/reports/export?format=${format}`, { method: "POST", headers: { Authorization: `Bearer ${manager}`, "Content-Type": "application/json" }, body: JSON.stringify(shared.definition) });
    check(`manager exports ${format}`, response.status === 200 && (await response.arrayBuffer()).byteLength > 0);
  }
  check("See cannot save", (await call("POST", "/api/corehr/reports", { name: "Not allowed", definition }, manager)).status === 403);
  check("See cannot share", (await call("PUT", `/api/corehr/reports/${report.id}/share`, { roleIds: [] }, manager)).status === 403);
  for (const [method, path, body] of [["GET", "/api/corehr/reports"], ["POST", "/api/corehr/reports/run", definition], ["POST", "/api/corehr/reports/export?format=csv", definition]])
    check(`employee without Reports: ${method} ${path}`, (await call(method, path, body, employee)).status === 403);
  check("another tenant cannot read a saved report", (await call("GET", `/api/corehr/reports/${report.id}`, null, elsewhere)).status === 404);
  check("another tenant cannot share it", (await call("PUT", `/api/corehr/reports/${report.id}/share`, { roleIds: [] }, elsewhere)).status === 404);
  const foreignRoles = await ok(elsewhere, "GET", "/api/corehr/reports/roles");
  check("cannot share with another tenant's role", (await call("PUT", `/api/corehr/reports/${report.id}/share`, { roleIds: [foreignRoles[0].id] }, hr)).status === 400);
  const fields = await ok(manager, "GET", "/api/corehr/reports/fields");
  const hrFields = await ok(hr, "GET", "/api/corehr/reports/fields");
  const hidden = hrFields.find(f => !fields.some(v => v.key === f.key));
  if (hidden) {
    check("manager cannot filter on a hidden field", (await call("POST", "/api/corehr/reports/run", { ...definition, filters: [{ field: hidden.key, values: ["private"] }] }, manager)).status === 403);
    check("manager cannot export a hidden field", (await call("POST", "/api/corehr/reports/export?format=csv", { ...definition, fields: [hidden.key] }, manager)).status === 403);
  }
  check("company roles stay inside their tenant", roles.every(r => !foreignRoles.some(f => f.id === r.id)));
  console.log(`Reports journey | Passed ${passed} | Failed 0 | Skipped 0`);
})().catch(error => { console.error(error.message); process.exit(1); });
