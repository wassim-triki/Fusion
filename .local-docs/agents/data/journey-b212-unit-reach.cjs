// B-212, through the shell. Amira Khelifi (administrator) gives Aicha Bouazizi (employee, nobody reports to her) a role
// "Unit readers" that reaches "their unit" for jobs, personal details, proposing changes, reports and plans. Then Aicha
// reads people in her unit (timeline, change drafts, reports, Performance summary) and not people outside it. (In
// Carthage everyone in Mariam Gharbi's unit is also in her branch, so a manager can't show the difference.) The preview endpoint is role editors only; another company and a forged Carthage header get nothing; no token 401.
// Deletes the role at the end, so Carthage is left as it was. Writes nothing else.
// Run: node .local-docs/agents/data/journey-b212-unit-reach.cjs   (stack up; FUSION_LOCAL_PASSWORD set)
const { BASE, call, login } = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");

let passed = 0;
let failed = 0;
function check(name, condition, detail) {
  if (condition) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ""}`); }
}
const claims = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
const claim = (token, suffix) => Object.entries(claims(token)).find(([k]) => k === suffix || k.endsWith(`/${suffix}`))?.[1];
const idOf = (key) => {
  const hex = key.replace(/^E-/, "").toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const headcount = { measure: "headcount", groupBy: "division", mode: "date", from: new Date().toISOString().slice(0, 10),
  to: new Date().toISOString().slice(0, 10), interval: "year", filters: [], fields: ["name"] };
const reportKeys = async (token) => {
  const r = await call("POST", "/api/corehr/reports/run", headcount, token);
  return { status: r.status, keys: new Set((r.json?.data?.people ?? []).map((p) => p.employeeKey)) };
};

(async () => {
  const amira = await login("amira.khelifi@example.test");
  let aicha = await login("aicha.bouazizi@example.test");
  const aichaUser = claim(aicha, "nameidentifier") ?? claims(aicha).sub;
  const aichaEmployee = claim(aicha, "employee_id");
  const before = await reportKeys(aicha);
  check("as an employee, Aicha can't run reports", before.status === 403, before.status);

  // The role.
  const overview = (await call("GET", "/api/identity/core-access/roles", null, amira)).json.data;
  for (const old of overview.roles.filter((r) => r.name === "Unit readers")) await call("DELETE", `/api/identity/core-access/roles/${old.id}`, null, amira);
  const created = await call("POST", "/api/identity/core-access/roles", { name: "Unit readers" }, amira);
  const role = created.json?.data?.role;
  check("Amira creates a role", (created.status === 200 || created.status === 201) && role, created.status);
  const unit = [["job", "see"], ["personal", "see"], ["approve", "propose"], ["reports", "see"], ["plans", "see"]]
    .map(([areaId, level]) => ({ areaId, level, reach: "unit" }));
  const cells = overview.areas.filter((a) => !a.administratorsOnly)
    .map((a) => unit.find((c) => c.areaId === a.id) ?? { areaId: a.id, level: "none", reach: null });
  const saved = await fetch(`${BASE}/api/identity/core-access/roles/${role.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${amira}`, "If-Match": `"${role.version}"` },
    body: JSON.stringify({ name: "Unit readers", description: null, cells, holderKind: "chosen", conditions: [], chosenUserIds: [aichaUser] }),
  });
  const savedBody = await saved.json().catch(() => null);
  check("and gives it their unit, chosen for Aicha", saved.status === 200
    && unit.every((c) => savedBody.data.role.cells.some((s) => s.areaId === c.areaId && s.level === c.level && s.reach === "unit")), savedBody);

  // The preview.
  const reach = await call("GET", `/api/corehr/roles/reach/${aichaEmployee}`, null, amira);
  check("the role page previews Aicha's unit", reach.status === 200 && reach.json.data.units.length > 0, reach.json);
  console.log("Aicha's unit:", reach.json.data.units.map((u) => `${"  ".repeat(u.depth)}${u.name} (${u.people})`).join(" | "), "→", reach.json.data.people, "people");

  aicha = await login("aicha.bouazizi@example.test");
  check("Aicha can't preview reach (she doesn't edit roles)", (await call("GET", `/api/corehr/roles/reach/${aichaEmployee}`, null, aicha)).status === 403);

  // Reports: wider than her team, narrower than the company.
  const after = await reportKeys(aicha);
  const all = await reportKeys(amira);
  const added = [...after.keys].filter((k) => !before.keys.has(k));
  const outside = [...all.keys].filter((k) => !after.keys.has(k) && idOf(k) !== aichaEmployee);
  check("her report now covers her unit", after.status === 200 && added.length > 0, { status: after.status, added: added.length });
  check("and not the whole company", outside.length > 0, { outside: outside.length });
  check("the count matches the preview", after.keys.size === reach.json.data.people, { report: after.keys.size, preview: reach.json.data.people });
  const inside = added[0];
  const beside = outside[0];

  // Jobs and history.
  check("she reads the history of someone in her unit", (await call("GET", `/api/corehr/employees/people/${inside}/timeline`, null, aicha)).status === 200);
  const besideTimeline = await call("GET", `/api/corehr/employees/people/${beside}/timeline`, null, aicha);
  check("not of someone outside it", besideTimeline.status === 404 || besideTimeline.status === 403, besideTimeline.status);

  // Proposing changes (the drafter saves nothing).
  const draftIn = await call("POST", `/api/corehr/changes/people/${inside}/draft`, { text: "Moves to Tunis next month" }, aicha);
  check("she may propose a change for someone in her unit", draftIn.status === 200, draftIn.json);
  const draftOut = await call("POST", `/api/corehr/changes/people/${beside}/draft`, { text: "Moves to Tunis next month" }, aicha);
  check("not for someone outside it", draftOut.status === 403, draftOut.json);

  // Performance: the plan on the person's summary.
  const perfIn = await call("GET", `/api/performance/people/${idOf(inside)}/summary`, null, aicha);
  check("Performance shows her unit's plans read-only", perfIn.status === 200 && perfIn.json.data.relation === "Observer"
    && perfIn.json.data.reviews === null, perfIn.json?.data?.relation);
  const perfOut = await call("GET", `/api/performance/people/${idOf(beside)}/summary`, null, aicha);
  check("not outside it", perfOut.status === 200 && perfOut.json.data.relation === "Other" && perfOut.json.data.currentCycle === null, perfOut.json?.data?.relation);

  // Another company.
  const freshAdmin = await login("amira.khelifi@fresh-5.example.test");
  const foreign = await call("GET", `/api/corehr/roles/reach/${aichaEmployee}`, null, freshAdmin);
  check("another company's administrator can't preview Carthage people", foreign.status === 404, foreign.status);
  const carthage = (await call("GET", "/api/identity/tenant-context/tenant-summary", null, aicha)).json.data.tenantId;
  const forged = await fetch(`${BASE}/api/corehr/roles/reach/${aichaEmployee}`, { headers: { Authorization: `Bearer ${freshAdmin}`, "X-Tenant-Id": carthage } });
  check("a header naming Carthage changes nothing", forged.status === 404 || forged.status === 403, forged.status);
  const freshPerson = (await reportKeys(freshAdmin)).keys.values().next().value;
  const crossTimeline = await call("GET", `/api/corehr/employees/people/${freshPerson}/timeline`, null, aicha);
  check("Aicha's unit never reaches another company", crossTimeline.status === 404 || crossTimeline.status === 403, crossTimeline.status);
  check("no token gets nothing", (await fetch(`${BASE}/api/corehr/roles/reach/${aichaEmployee}`)).status === 401);

  const removed = await call("DELETE", `/api/identity/core-access/roles/${role.id}`, null, amira);
  check("the role is removed again", removed.status === 204 || removed.status === 200, removed.status);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
