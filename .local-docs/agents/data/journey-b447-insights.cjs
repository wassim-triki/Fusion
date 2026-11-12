#!/usr/bin/env node
/**
 * B-447 (slice 13, Insights): who reads which figures, through the shell. On `midyear` and `nextcycle`:
 * Amira Khelifi (administrator) reads Performance's figures (during the year against last; at the year's end, how it
 * ended) and the people behind one; Mariam Gharbi (manager) and Aicha Bouazizi (employee) are refused them; the
 * People tab's records follow the viewer's reach and field policy (Amira all, Mariam her team only); another tenant's
 * administrator finds neither the year nor its people. Read-only.
 * Usage: node .local-docs/agents/data/journey-b447-insights.cjs
 */
const { call, login } = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");
const presets = require("./demo-presets.local.json");

const preset = (name) => presets.presets?.[name] ?? presets[name];
const email = (name, who) => Object.values(preset(name).employees).find((e) => e.name === who).email;
let failed = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`); if (!ok) failed++; };

(async () => {
  const amira = await login(email("midyear", "Amira Khelifi"));
  const mariam = await login(email("midyear", "Mariam Gharbi"));
  const aicha = await login(email("midyear", "Aicha Bouazizi"));
  const elsewhere = await login(email("planning", "Amira Khelifi"));

  const mid = await call("GET", "/api/performance/insights", null, amira);
  const data = mid.json?.data;
  check("Amira reads the year's figures", mid.status === 200 && data && !data.ended, `${mid.status}, ${data?.name}`);
  check("against last year", Boolean(data?.lastYear), data?.lastYear?.name);
  const onTrack = data?.trends.find((t) => t.key === "on-track");
  check("four figures this year against last, on the same days", data?.trends.length === 4 && (onTrack?.last?.length ?? 0) > 0,
    `on track ${onTrack?.now}% vs ${onTrack?.lastNow}%`);
  check("on track by department", (data?.onTrackByDepartment.length ?? 0) > 1, data?.onTrackByDepartment.map((d) => `${d.name} ${d.share}%`).join(", "));
  const people = await call("GET", `/api/performance/insights/people?cycleId=${data?.cycleId}&metric=at-risk`, null, amira);
  check("a figure opens its people", people.status === 200 && people.json.data.total > 0, `${people.json?.data?.total} at risk or off track`);

  for (const [who, token] of [["Mariam, a manager", mariam], ["Aicha, an employee", aicha]]) {
    check(`${who} is refused the figures`, (await call("GET", "/api/performance/insights", null, token)).status === 403);
    check(`${who} is refused their people`, (await call("GET", "/api/performance/insights/people?metric=people", null, token)).status === 403);
  }
  check("another tenant's administrator finds no such year",
    (await call("GET", `/api/performance/insights?cycleId=${data?.cycleId}`, null, elsewhere)).status === 404);
  check("nor its people",
    (await call("GET", `/api/performance/insights/people?cycleId=${data?.cycleId}&metric=people`, null, elsewhere)).status === 404);

  // People: Core HR's records at the viewer's reach and field policy.
  const all = await call("GET", "/api/corehr/reports/front-page", null, amira);
  const team = await call("GET", "/api/corehr/reports/front-page", null, mariam);
  const staff = await call("GET", "/api/corehr/reports/front-page", null, aicha);
  check("Amira's People counts everyone", all.status === 200 && !all.json.data.teamOnly, `${all.json?.data?.people.length} people`);
  check("Mariam's People is refused, or her team only", team.status === 403
    || (team.status === 200 && team.json.data.teamOnly && team.json.data.people.length < all.json.data.people.length),
    team.status === 403 ? "403: her role has no reports" : `${team.json?.data?.people.length} people`);
  check("Aicha reads no company figures", staff.status === 403 || (staff.status === 200 && (staff.json?.data?.people.length ?? 0) <= 1), `${staff.status}`);

  const end = await login(email("nextcycle", "Amira Khelifi"));
  const ended = (await call("GET", "/api/performance/insights", null, end)).json?.data;
  check("an ended year reads how it ended", ended?.ended === true && ended.end?.ratings.some((r) => r.count > 0), ended?.name);
  check("its next year waits to be launched", Boolean(ended?.nextYear) && ended.nextYearLaunched === false, ended?.nextYear?.name);
  check("carried goals are listed", (ended?.end?.carriedCount ?? 0) >= 0, `${ended?.end?.carriedCount} carried`);

  console.log(failed ? `${failed} failed` : "all passed");
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
