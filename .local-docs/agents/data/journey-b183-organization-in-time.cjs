// B-183 API journey, through the shell like the browser:
//   node .local-docs/agents/data/journey-b183-organization-in-time.cjs
// In Carthage Digital Group: Amira (HR) reads every unit's people and head as of today, the past and the future; plans
// Delivery's move under Consulting on 1 January (once; the demo's planned unit change) and sees the structure and
// counts follow it on that date; opens a unit's page. Mariam (manager with Organization view) reads today only; Leila
// (employee) reads neither; another company's administrator can't open a Carthage unit.
const path = require("path");
const { call, login } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const BASE = "http://localhost:3000";
const data = (r) => r.json?.data;
const results = [];
function check(label, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  return ok;
}
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

(async () => {
  const amira = await login("amira.khelifi@example.test");
  const mariam = await login("mariam.gharbi@example.test");
  const leila = await login("leila.baccouche@example.test");
  const elsewhere = await login("amira.khelifi@midyear-5.example.test");
  const today = day(0);
  const moveDay = `${new Date().getUTCFullYear() + 1}-01-01`;

  const hierarchy = data(await call("GET", `/api/corehr/organization/hierarchy?asOf=${today}`, null, amira));
  const units = new Map();
  const visit = (node) => { units.set(node.unit.name, node.unit); node.children.forEach(visit); };
  hierarchy.roots.forEach(visit);
  const [root, consulting, delivery, solutions] = ["Carthage Digital Group", "Consulting", "Delivery", "Client Solutions"].map((n) => units.get(n));

  const now = await call("GET", `/api/corehr/org-chart/staffing?asOf=${today}`, null, amira);
  const byId = (r) => new Map((data(r)?.units ?? []).map((u) => [u.unitId, u]));
  const todayUnits = byId(now);
  check("HR reads every unit's people as of today", now.status === 200 && todayUnits.size === units.size, `${todayUnits.size} units`);
  check("The company counts everyone, its head at the top", todayUnits.get(root.id)?.people === 100 && Boolean(todayUnits.get(root.id)?.head),
    `${todayUnits.get(root.id)?.people} · ${todayUnits.get(root.id)?.head?.displayName}`);
  check("A unit counts the units under it", todayUnits.get(solutions.id).people
    >= todayUnits.get(consulting.id).people + todayUnits.get(delivery.id).people);
  check("The slider starts on the company's first day", /^\d{4}-\d{2}-\d{2}$/.test(data(now).firstDate ?? ""), data(now).firstDate);

  const before = await call("GET", `/api/corehr/org-chart/staffing?asOf=${data(now).firstDate}`, null, amira);
  const first = byId(before).get(root.id)?.people ?? 0;
  check("On the first day the company was smaller", before.status === 200 && first < 100, `${first} people`);

  // The demo's planned unit change: Delivery moves under Consulting on 1 January (planned once).
  const planned = data(await call("GET", "/api/corehr/organization/changes/upcoming", null, amira)) ?? [];
  if (!planned.some((change) => change.orgUnitId === delivery.id && change.effectiveDate === moveDay && !change.isCancelled)) {
    const moved = await fetch(`${BASE}/api/corehr/organization/units/${delivery.id}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${amira}`, "If-Match": `"${delivery.version}"` },
      body: JSON.stringify({ targetParentId: consulting.id, effectiveDate: moveDay, reason: "Delivery joins Consulting" }),
    });
    check("HR plans Delivery's move under Consulting", moved.ok, `${moved.status}`);
  }
  const listed = data(await call("GET", "/api/corehr/organization/changes/upcoming", null, amira)) ?? [];
  check("The move is planned", listed.some((change) => change.orgUnitId === delivery.id && change.effectiveDate === moveDay));

  const later = await call("GET", `/api/corehr/org-chart/staffing?asOf=${moveDay}`, null, amira);
  const laterUnits = byId(later);
  check("On its date Consulting counts Delivery's people", later.status === 200
    && laterUnits.get(consulting.id).people >= todayUnits.get(consulting.id).people + laterUnits.get(delivery.id).people - 1,
    `${todayUnits.get(consulting.id).people} → ${laterUnits.get(consulting.id).people}`);
  const laterTree = data(await call("GET", `/api/corehr/organization/hierarchy?asOf=${moveDay}`, null, amira));
  const parentOf = (nodes, id, parent = null) => nodes.reduce((found, n) => found ?? (n.unit.id === id ? parent : parentOf(n.children, id, n.unit.id)), null);
  check("On its date the structure shows Delivery under Consulting", parentOf(laterTree.roots, delivery.id) === consulting.id);

  const page = await call("GET", `/api/corehr/org-chart/units/${consulting.id}?asOf=${today}`, null, amira);
  check("A unit's page brings its head and everyone in it", page.status === 200 && data(page).head?.displayName
    && data(page).people.length === todayUnits.get(consulting.id).people, `${data(page)?.head?.displayName} · ${data(page)?.people.length}`);
  check("An unknown unit is not found", (await call("GET", `/api/corehr/org-chart/units/00000000-0000-0000-0000-000000000001`, null, amira)).status === 404);

  const managerToday = await call("GET", `/api/corehr/org-chart/staffing?asOf=${today}`, null, mariam);
  check("A manager with Organization view reads today", managerToday.status === 200);
  check("…but not another date", (await call("GET", `/api/corehr/org-chart/staffing?asOf=${moveDay}`, null, mariam)).status === 403
    && (await call("GET", `/api/corehr/org-chart/units/${consulting.id}?asOf=${day(-30)}`, null, mariam)).status === 403);
  check("An employee reads neither counts nor unit pages", (await call("GET", "/api/corehr/org-chart/staffing", null, leila)).status === 403
    && (await call("GET", `/api/corehr/org-chart/units/${consulting.id}`, null, leila)).status === 403);
  const foreign = await call("GET", `/api/corehr/org-chart/units/${consulting.id}`, null, elsewhere);
  check("Another company can't open a Carthage unit", foreign.status === 404, `${foreign.status}`);
  const theirs = byId(await call("GET", "/api/corehr/org-chart/staffing", null, elsewhere));
  check("Another company's counts hold none of Carthage's units", !theirs.has(consulting.id) && theirs.size > 0);

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
