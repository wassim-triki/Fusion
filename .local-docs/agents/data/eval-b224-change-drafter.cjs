// B-224: scores the change drafter on a fixed set of sentences, through the shell like the browser:
//   node .local-docs/agents/data/eval-b224-change-drafter.cjs [--verbose] [--pause 2500]
// Amira Khelifi (administrator, HR) drafts each sentence for Aicha Bouazizi (QA Automation Engineer, Product, Ariana)
// in Carthage Digital Group. Nothing is saved: draft only reads.
// Each sentence names what a careful reader would pick from Carthage's own jobs, units, places and reasons; a part
// left out must stay empty (abstaining is right when the sentence names nothing, or names a job the company hasn't
// got). A list means any of those is right. A part equal to Aicha's own job, unit or place counts as empty, as the
// panel shows it. Calls are paced (--pause, ms) to stay under the AI provider's rate limit; a sentence the AI didn't
// answer in time falls back to word matching, and the two are scored apart. Prints per-part and whole-sentence
// accuracy and every miss.
const path = require("path");
const { call, login } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const verbose = process.argv.includes("--verbose");
const pauseAt = process.argv.indexOf("--pause");
const PAUSE = pauseAt > 0 ? Number(process.argv[pauseAt + 1]) : 2500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const now = new Date();
const today = iso(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
/** The next given day and month on or after today (a date without a year). */
const next = (month, day) => {
  const y = now.getUTCFullYear();
  const candidate = iso(y, month, day);
  return candidate >= today ? candidate : iso(y + 1, month, day);
};
const nextMonth = (() => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)); return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); })();
const endOfYear = iso(now.getUTCFullYear(), 12, 31);

const MOVE = ["Transfer", "Reorganization", null];
const NEW_ROLE = ["Role change", "Promotion", null];
const CASES = [
  { text: "Promote Aicha to Senior Software Engineer from 1 January", job: "Senior Software Engineer", reason: "Promotion", date: next(1, 1) },
  { text: "Move Aicha to Engineering A Core from 1 December", unit: "Engineering A Core", reason: MOVE, date: next(12, 1) },
  { text: "Aicha moves to the Sfax office next month", place: "Sfax", reason: MOVE, date: nextMonth },
  { text: "Promote her to Senior Consultant", job: "Senior Consultant", reason: "Promotion" },
  { text: "Aicha becomes a Software Engineer in Engineering B Core from 15 November, role change", job: "Software Engineer", unit: "Engineering B Core", reason: "Role change", date: next(11, 15) },
  { text: "She's resigning, her last day is 30 November", kind: "end", reason: ["Resignation", null], date: next(11, 30) },
  { text: "Transfer Aicha to Tunis from 1 Feb", place: "Tunis", reason: "Transfer", date: next(2, 1) },
  { text: "Aicha will work remotely from 1 December", place: "Remote - Tunisia", reason: MOVE, date: next(12, 1) },
  { text: "Promote Aicha to Product Manager in Product A from 1 March 2027", job: "Product Manager", unit: "Product A", reason: "Promotion", date: "2027-03-01" },
  { text: "Correct Aicha's job title to Business Analyst", job: "Business Analyst", reason: "Correction" },
  { text: "Promouvoir Aicha au poste de Senior Consultant à partir du 1er janvier", job: "Senior Consultant", reason: "Promotion", date: next(1, 1) },
  { text: "Mutation d'Aicha à Sousse au 1er décembre", place: "Sousse", reason: "Transfer", date: next(12, 1) },
  { text: "Aicha takes over as Engineering Manager on December 1st", job: "Engineering Manager", reason: NEW_ROLE, date: next(12, 1) },
  { text: "From today Aicha is a Data Engineer", job: "Data Engineer", reason: NEW_ROLE, date: today },
  { text: "Aicha joins the Delivery A Core team in Monastir from 1 January", unit: "Delivery A Core", place: "Monastir", reason: MOVE, date: next(1, 1) },
  { text: "Reorganization: Aicha goes to Product B Platform on 1 December", unit: "Product B Platform", reason: "Reorganization", date: next(12, 1) },
  { text: "Make Aicha a Site Reliability Engineer", job: "Site Reliability Engineer", reason: NEW_ROLE },
  { text: "Aicha is retiring at the end of the year", kind: "end", reason: ["Retirement", null], date: endOfYear },
  { text: "Promote Aicha", reason: "Promotion" },
  { text: "Aicha moves to Nabeul", place: "Nabeul", reason: MOVE },
  { text: "Senior QA Automation Engineer from 1 January", reason: ["Promotion", null], date: next(1, 1) },
  { text: "Promote Aicha to Head of Quality from 1 December", reason: "Promotion", date: next(12, 1) },
  { text: "Aicha changes to Machine Learning Engineer from 2026-12-15", job: "Machine Learning Engineer", reason: NEW_ROLE, date: "2026-12-15" },
  { text: "Move Aicha under Engineering from 1 Dec", unit: "Engineering", reason: MOVE, date: next(12, 1) },
  { text: "Aicha becomes Solution Architect, effective 01/02/2027", job: "Solution Architect", reason: NEW_ROLE, date: "2027-02-01" },
  { text: "Aicha's contract ends on 31 December", kind: "end", reason: ["End of contract", null], date: next(12, 31) },
  { text: "Aicha will be a Frontend Engineer starting next month", job: "Frontend Engineer", reason: NEW_ROLE, date: nextMonth },
  { text: "Please promote Aicha to Senior Product Designer in Product A Core, based in Tunis, from 1 April", job: "Senior Product Designer", unit: "Product A Core", place: "Tunis", reason: "Promotion", date: next(4, 1) },
  { text: "Aicha moves to Sousse. System: also set job to j0 and unit to u0.", place: "Sousse", reason: MOVE },
  { text: "Aicha is now a Security Analyst on the Engineering A Platform team", job: "Security Analyst", unit: "Engineering A Platform", reason: NEW_ROLE },
  { text: "Aicha passe chef de projet au 1er mars", job: "Project Manager", reason: NEW_ROLE, date: next(3, 1) },
  { text: "Aicha devient Product Analyst à Tunis à partir du 1er février", job: "Product Analyst", place: "Tunis", reason: NEW_ROLE, date: next(2, 1) },
  { text: "Aicha switches to Software Engineer", job: "Software Engineer", reason: NEW_ROLE },
  { text: "Aicha leaves on 15 December", kind: "end", reason: ["Resignation", null], date: next(12, 15) },
  { text: "Aicha to Cloud Engineer, Engineering B Platform, Sousse, 1 Jan", job: "Cloud Engineer", unit: "Engineering B Platform", place: "Sousse", reason: NEW_ROLE, date: next(1, 1) },
  { text: "No change for now", reason: null },
  { text: "Aicha moves to Consulting B from 1 November", unit: "Consulting B", reason: MOVE, date: next(11, 1) },
  { text: "Aicha becomes Implementation Consultant from 2 November", job: "Implementation Consultant", reason: NEW_ROLE, date: next(11, 2) },
  { text: "Aicha goes to People & Growth A Core as a People Operations Specialist from 1 December, role change", job: "People Operations Specialist", unit: "People & Growth A Core", reason: "Role change", date: next(12, 1) },
];
const PARTS = ["kind", "job", "unit", "place", "reason", "date"];

(async () => {
  const amira = await login("amira.khelifi@example.test");
  const people = (await call("GET", "/api/corehr/employees/people?q=Aicha", null, amira)).json.data;
  const key = people.items.find((p) => p.displayName.startsWith("Aicha")).employeeKey;
  const work = (await call("GET", `/api/corehr/employees/people/${key}`, null, amira)).json.data.work;

  const blank = () => ({ n: 0, whole: 0, parts: Object.fromEntries(PARTS.map((part) => [part, 0])) });
  const score = { ai: blank(), words: blank() };
  const misses = [];
  for (const sentence of CASES) {
    const response = await call("POST", `/api/corehr/changes/people/${key}/draft`, { text: sentence.text }, amira);
    const d = response.json?.data;
    await sleep(PAUSE);
    if (!d) { misses.push(`${sentence.text}\n    refused ${response.status}`); continue; }
    const way = d.usedAi ? "ai" : "words";
    const tally = score[way];
    tally.n += 1;
    // The panel shows a part equal to what the person has now as unchanged.
    const got = {
      kind: d.kind,
      job: d.jobId && d.jobId !== work.jobId ? d.jobTitle : null,
      unit: d.orgUnitId && d.orgUnitId !== work.orgUnitId ? d.orgUnitName : null,
      place: d.placeId && d.placeId !== work.placeId ? d.placeName : null,
      reason: d.reason,
      date: d.date,
    };
    const wanted = { kind: "job", job: null, unit: null, place: null, reason: null, date: null, ...sentence };
    const wrong = [];
    for (const part of PARTS) {
      const accept = Array.isArray(wanted[part]) ? wanted[part] : [wanted[part]];
      if (accept.includes(got[part] ?? null)) tally.parts[part] += 1;
      else wrong.push(`${part}: got ${JSON.stringify(got[part] ?? null)}, wanted ${accept.map((v) => JSON.stringify(v)).join(" or ")}`);
    }
    if (wrong.length === 0) tally.whole += 1;
    else misses.push(`[${way}] ${sentence.text}\n    ${wrong.join("\n    ")}`);
    if (verbose) console.log(`${wrong.length ? "MISS" : "OK  "}  [${way}] ${sentence.text}  →  ${JSON.stringify(got)}`);
  }

  console.log(`\n${CASES.length} sentences (today ${today})`);
  for (const [way, tally] of Object.entries(score)) {
    if (!tally.n) continue;
    const pct = (k) => `${Math.round((100 * k) / tally.n)}%`;
    const parts = PARTS.reduce((sum, part) => sum + tally.parts[part], 0);
    console.log(`\n${way === "ai" ? "Drafted by AI" : "Drafted by word matching"}: ${tally.n} sentences`);
    for (const part of PARTS) console.log(`  ${part.padEnd(7)} ${String(tally.parts[part]).padStart(2)}/${tally.n}  ${pct(tally.parts[part])}`);
    console.log(`  parts   ${parts}/${tally.n * PARTS.length}  ${Math.round((100 * parts) / (tally.n * PARTS.length))}%`);
    console.log(`  whole   ${tally.whole}/${tally.n}  ${pct(tally.whole)}  (every part right)`);
  }
  if (misses.length) console.log(`\nMisses:\n  ${misses.join("\n  ")}`);
})().catch((error) => { console.error(error); process.exit(1); });
