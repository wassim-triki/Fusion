// B-287 demo data, through the shell like the browser:
//   node .local-docs/agents/data/seed-b287-filled-role.cjs
// In Carthage Digital Group, as Amira (HR): an open QA Automation Engineer role in Mariam Gharbi's team, filled by
// Ons Khemiri (the B-248 joiner, b247-b248.local.json) from her first day, so Core HR's front page shows
// "Filled · Ons Khemiri, <day>" as D-30 draws it. Re-runnable: the role is made once and filled again with the same facts.
const fs = require("fs");
const path = require("path");
const { call, login } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const data = (r) => r.json?.data;
const TITLE = "QA Automation Engineer";

async function seed() {
  const ons = JSON.parse(fs.readFileSync(path.join(__dirname, "b247-b248.local.json"), "utf8"));
  const amira = await login("amira.khelifi@example.test");
  const mariam = data(await call("GET", "/api/corehr/workforce/me", null, await login("mariam.gharbi@example.test"))).employee;

  // Her first day, as the front page has it.
  const front = data(await call("GET", "/api/corehr/reports/front-page", null, amira));
  const onsOnPage = front.people.find((person) => person.employeeKey === ons.employeeKey);
  if (!onsOnPage) throw new Error("Ons Khemiri isn't on Carthage's front page; run journey-b247-b248.cjs first");
  const firstDay = onsOnPage.spans[0].from;

  const jobs = data(await call("GET", "/api/corehr/catalog/jobs", null, amira)) ?? [];
  let job = jobs.find((item) => item.title === TITLE && !item.isRetired);
  if (!job) {
    const made = await call("POST", "/api/corehr/catalog/jobs", { title: TITLE }, amira);
    if (made.status !== 201 && made.status !== 200) throw new Error(`job: ${made.status} ${JSON.stringify(made.json)}`);
    job = data(made);
    console.log(`job ${TITLE} added`);
  }

  const role = { jobId: job.id, managerKey: mariam.stableEmployeeKey, orgUnitId: mariam.orgUnit.orgUnitId };
  const already = front.openRoles.find((item) => item.job === TITLE);
  let id = already?.id;
  if (!id) {
    const made = await call("POST", "/api/corehr/org-chart/open-roles", { ...role, status: "Open" }, amira);
    if (made.status !== 201) throw new Error(`open role: ${made.status} ${JSON.stringify(made.json)}`);
    id = data(made).id;
    console.log(`open role ${TITLE} added to Mariam's team`);
  }
  const filled = await call("PUT", `/api/corehr/org-chart/open-roles/${id}`,
    { ...role, status: "Filled", filledByKey: ons.employeeKey, filledOn: firstDay }, amira);
  if (filled.status !== 200) throw new Error(`fill: ${filled.status} ${JSON.stringify(filled.json)}`);
  console.log(`${TITLE} filled by Ons Khemiri from ${firstDay}`);
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
