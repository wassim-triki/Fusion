#!/usr/bin/env node
/**
 * B-166 mock data: reads Carthage · Mid-year through the API as Amira (people, Aicha's record, units) and writes a
 * compact JSON the explorer's mocks are drawn from, to .local-docs/agents/plans/B-166-screens/carthage.local.json.
 * Usage: node .local-docs/agents/data/read-b166-carthage.cjs   Read-only.
 */
const path = require("path");
const fs = require("fs");
const helper = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");

const OUT = path.join(__dirname, "..", "plans", "B-166-screens", "carthage.local.json");
const day = (value) => (value ? String(value).slice(0, 10) : null);

(async () => {
  const token = await helper.login("amira.khelifi@midyear-5.example.test");
  const get = async (route) => (await helper.call("GET", route, undefined, token)).json?.data;
  const list = await get("/api/corehr/employees/people?pageSize=200");
  const people = (list?.items ?? []).map((person) => ({
    key: person.employeeKey,
    number: person.employeeNumber,
    name: person.displayName,
    title: person.work?.jobTitle,
    unit: person.work?.organizationName,
    path: person.work?.organizationPath,
    location: person.work?.location,
    start: day(person.employmentStart),
    state: person.employmentState,
    manager: person.primaryManager?.displayName ?? null,
  }));
  const aichaKey = people.find((person) => person.name.startsWith("Aicha"))?.key;
  const aicha = aichaKey ? await get(`/api/corehr/employees/people/${aichaKey}`) : null;
  const units = await get("/api/corehr/organization/hierarchy").catch(() => null);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ readOn: new Date().toISOString().slice(0, 10), people, aicha, units }, null, 1));
  console.log(`${people.length} people, Aicha ${aicha ? "read" : "missing"}, units ${units ? "read" : "missing"} -> ${OUT}`);
})().catch((error) => { console.error(error); process.exit(1); });
