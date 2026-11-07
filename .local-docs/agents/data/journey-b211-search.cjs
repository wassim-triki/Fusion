// B-211: the top bar search's two reads, through the shell. Reads only; changes no data.
// Carthage's administrator, a manager and an employee each find what they may open; jobs are HR's; another company
// finds none of Carthage's people or objectives, even with a header naming Carthage; no token gets nothing.
// Run: node .local-docs/agents/data/journey-b211-search.cjs   (stack up; FUSION_LOCAL_PASSWORD set)
const { BASE, call, login } = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");

let passed = 0;
let failed = 0;
function check(name, condition, detail) {
  if (condition) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ""}`); }
}
const core = (q, token) => call("GET", `/api/corehr/search?q=${encodeURIComponent(q)}`, null, token);
const perf = (q, token) => call("GET", `/api/performance/search?q=${encodeURIComponent(q)}`, null, token);

(async () => {
  const amira = await login("amira.khelifi@example.test");
  const mariam = await login("mariam.gharbi@example.test");
  const aicha = await login("aicha.bouazizi@example.test");

  const mine = await core("", aicha);
  const manager = mine.json?.data?.people?.[0];
  check("before typing, an employee gets their manager first", mine.status === 200 && manager?.relation === "Manager", mine);

  const byName = await core("aïcha", mariam);
  const found = byName.json?.data?.people?.find((p) => p.displayName === "Aicha Bouazizi");
  check("accents don't matter and a manager's report says so", found?.relation === "Report", byName.json?.data?.people);
  check("a manager gets no jobs", (byName.json?.data?.jobs ?? []).length === 0 && (await core("engineer", mariam)).json.data.jobs.length === 0);
  check("an administrator gets jobs", (await core("engineer", amira)).json?.data?.jobs?.length > 0);

  const strategy = await perf("grow", aicha);
  check("an employee finds published company objectives", strategy.status === 200 && Array.isArray(strategy.json?.data?.objectives), strategy);
  check("an employee gets no cycles", (await perf("fy", aicha)).json?.data?.cycles?.length === 0);
  check("an administrator finds the cycle", (await perf("fy", amira)).json?.data?.cycles?.length > 0);

  // Another company: the Fresh demo preset's Leila.
  const outsider = await login("leila.baccouche@fresh-5.example.test");
  const outsiderPeople = (await core("aicha", outsider)).json?.data?.people ?? [];
  check("another company never finds Carthage's people", !outsiderPeople.some((p) => p.employeeKey === found?.employeeKey), outsiderPeople);
  const carthage = (await call("GET", "/api/identity/tenant-context/tenant-summary", null, aicha)).json.data.tenantId;
  const forged = await fetch(`${BASE}/api/corehr/search?q=aicha`, { headers: { Authorization: `Bearer ${outsider}`, "X-Tenant-Id": carthage } });
  const forgedBody = await forged.json().catch(() => null);
  check("a header naming Carthage changes nothing", !(forgedBody?.data?.people ?? []).some((p) => p.employeeKey === found?.employeeKey), forgedBody);
  const carthageObjectives = new Set(((await perf("grow", amira)).json?.data?.objectives ?? []).map((o) => o.id));
  const outsiderObjectives = (await perf("grow", outsider)).json?.data?.objectives ?? [];
  check("another company never finds Carthage's objectives", !outsiderObjectives.some((o) => carthageObjectives.has(o.id)), outsiderObjectives);

  const anonymous = await fetch(`${BASE}/api/corehr/search?q=a`);
  check("no token gets nothing", anonymous.status === 401);
  const platform = await core("a", await login("admin@ey-hr.com"));
  check("the platform administrator gets no people", platform.status >= 400 || (platform.json?.data?.people ?? []).length === 0, platform);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
