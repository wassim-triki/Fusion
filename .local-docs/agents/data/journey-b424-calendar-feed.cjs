#!/usr/bin/env node
/**
 * B-424 (slice 6, 1:1s): the calendar feed's token through the shell, with its negatives. On the `midyear` preset,
 * Mariam Gharbi (manager) makes her link; it reads without a session and lists only her 1:1s; the same secret under
 * another tenant, a signed-in person of another tenant, a replaced link and a turned-off link all read nothing. Also
 * reads her 1:1 with Aicha Bouazizi (employee) for the agenda's sources and the panel beside it. Leaves her link off.
 * Usage: node .local-docs/agents/data/journey-b424-calendar-feed.cjs
 */
const { call, login } = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");
const presets = require("./demo-presets.local.json");

const preset = (name) => presets.presets?.[name] ?? presets[name];
const email = (name, who) => Object.values(preset(name).employees).find((e) => e.name === who).email;
let failed = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`); if (!ok) failed++; };
const feedPath = (url) => new URL(url).pathname;

(async () => {
  const mariam = await login(email("midyear", "Mariam Gharbi"));
  const elsewhere = await login(email("planning", "Mariam Gharbi"));

  const list = await call("GET", "/api/performance/one-on-ones", null, mariam);
  const row = list.json.data.reports.find((r) => r.with.displayName.startsWith("Aicha"));
  check("Mariam has 1:1s with Aicha", Boolean(row));
  const series = (await call("GET", `/api/performance/one-on-ones/${row.seriesId}`, null, mariam)).json.data;
  const kinds = [...new Set(series.upcoming.suggestions.map((s) => s.kind))];
  check("the agenda offers what the year holds", series.upcoming.suggestions.length > 0, kinds.join(", "));
  check("the panel carries Aicha's goals", (series.context?.goals ?? []).length > 0, `${series.context?.goals.length} goals`);

  const made = await call("POST", "/api/performance/one-on-ones/calendar-feed", {}, mariam);
  check("making a link returns it once", made.status === 200 && typeof made.json.data.url === "string");
  const path = feedPath(made.json.data.url);
  const status = await call("GET", "/api/performance/one-on-ones/calendar-feed", null, mariam);
  check("reading the status never returns the link", status.json.data.on === true && status.json.data.url === null);

  const feed = await fetch(`http://localhost:3000${path}`);
  const ics = await feed.text();
  check("the feed reads without a session", feed.status === 200 && ics.startsWith("BEGIN:VCALENDAR"), `${feed.status}`);
  check("it lists Mariam's 1:1 with Aicha", ics.includes("SUMMARY:1:1 with Aicha"));
  check("it lists no 1:1 Mariam isn't in", !ics.includes("1:1 with Omar"));

  const token = path.slice("/api/performance/calendar/".length, -".ics".length);
  const secret = token.slice(token.indexOf(".") + 1);
  const otherTenant = preset("planning").tenantId.replaceAll("-", "");
  check("the secret under another tenant reads nothing",
    (await fetch(`http://localhost:3000/api/performance/calendar/${otherTenant}.${secret}.ics`)).status === 404);
  check("a signed-in person of another tenant reads nothing",
    (await fetch(`http://localhost:3000${path}`, { headers: { Authorization: `Bearer ${elsewhere}` } })).status === 404);
  check("a made-up token reads nothing", (await fetch("http://localhost:3000/api/performance/calendar/nonsense.ics")).status === 404);

  const replaced = await call("POST", "/api/performance/one-on-ones/calendar-feed", {}, mariam);
  check("a new link replaces the old one", (await fetch(`http://localhost:3000${path}`)).status === 404);
  await call("DELETE", "/api/performance/one-on-ones/calendar-feed", null, mariam);
  check("turning it off stops the new one too", (await fetch(`http://localhost:3000${feedPath(replaced.json.data.url)}`)).status === 404);

  console.log(failed ? `${failed} failed` : "all passed");
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
