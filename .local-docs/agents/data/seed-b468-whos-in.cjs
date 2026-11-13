// B-468 (queue row 5): gives the `nextcycle` preset what its Leave out rules read, through the shell as Amira Khelifi:
//   node .local-docs/agents/data/seed-b468-whos-in.cjs [domain]
// Three people become contractors from today (a job change with its employment type) and Wafa Mhenni goes on leave
// from today for four months, so she is on leave the day next year starts. Re-runnable: anyone already a contractor
// or already on leave is left as they are. Changes Core HR only; next year's draft keeps whatever rules it has.
const path = require("path");
const { PASSWORD, call } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const domain = process.argv[2] ?? require(path.join(__dirname, "demo-presets.local.json")).presets.nextcycle.domain;
const CONTRACTORS = ["Lotfi Bouhlel", "Hela Ben Amor", "Atef Ben Jannet"];
const ON_LEAVE = "Wafa Mhenni";
const iso = (date) => date.toISOString().slice(0, 10);
const days = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

(async () => {
  const login = await call("POST", "/api/identity/auth/login", { email: `amira.khelifi@${domain}`, password: PASSWORD });
  if (login.status !== 200) throw new Error(`Sign-in failed for Amira on ${domain}: ${login.status}`);
  const token = login.json.data.accessToken;
  const people = (await call("GET", "/api/corehr/reports/front-page", null, token)).json.data.people;
  const lists = (await call("GET", "/api/corehr/catalog/lists", null, token)).json.data;
  const contractor = lists.find((list) => list.id === "employment-types").values.find((value) => value.label === "Contractor");
  const annual = lists.find((list) => list.id === "leave-types").values.find((value) => value.label === "Annual leave");
  if (!contractor || !annual) throw new Error("Carthage's lists have no Contractor type or Annual leave");
  const setup = (await call("GET", "/api/performance/cycles/setup", null, token)).json.data;
  const facts = new Map(setup.everyone.map((p) => [p.name, p]));
  const keyOf = (name) => {
    const found = people.find((p) => p.name === name);
    if (!found) throw new Error(`${name} isn't at Carthage on ${domain}`);
    return found.employeeKey;
  };

  for (const name of CONTRACTORS) {
    if (facts.get(name)?.employmentType === "Contractor") { console.log(`${name} is already a contractor`); continue; }
    const set = await call("POST", `/api/corehr/changes/people/${keyOf(name)}/propose`,
      { job: { effectiveDate: `${days(0)}T00:00:00Z`, employmentTypeId: contractor.id } }, token);
    console.log(`${name} a contractor: ${set.status}`);
    if (set.status !== 200) throw new Error(JSON.stringify(set.json));
  }
  if (facts.get(ON_LEAVE)?.onLeave) console.log(`${ON_LEAVE} is already on leave on day one`);
  else {
    const set = await call("POST", `/api/corehr/changes/people/${keyOf(ON_LEAVE)}/propose`,
      { leave: { leaveTypeId: annual.id, from: days(0), until: days(120) } }, token);
    console.log(`${ON_LEAVE} on leave: ${set.status}`);
    if (set.status !== 200) throw new Error(JSON.stringify(set.json));
  }
  const after = (await call("GET", "/api/performance/cycles/setup", null, token)).json.data;
  console.log(`contractors ${after.everyone.filter((p) => p.employmentType === "Contractor").length}, on leave on day one ${after.everyone.filter((p) => p.onLeave).length}, can be in ${after.everyone.length}, divisions ${after.divisions.map((d) => d.name).join(", ")}`);
})().catch((error) => { console.error(error); process.exit(1); });
