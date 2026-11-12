#!/usr/bin/env node
/**
 * B-440 (slice 12, closing a year and setting up the next): who may set up and launch a year, through the shell, with
 * its negatives. On the `nextcycle` preset (this year ended with results out, next year waiting as a draft) Amira
 * Khelifi (administrator) reads the setup: the draft, last year's steps, who's in and what comes along; Mariam Gharbi
 * (manager) and Aicha Bouazizi (employee) can't read, save or launch it. On `midyear` (this year mid-way) a year can't
 * launch while this one runs, and Amira of `midyear` can't touch `nextcycle`'s draft. Launches nothing that stays: the
 * draft it makes on `midyear` is deleted.
 * Usage: node .local-docs/agents/data/journey-b440-year-setup.cjs
 */
const { call, login } = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");
const presets = require("./demo-presets.local.json");

const preset = (name) => presets.presets?.[name] ?? presets[name];
const email = (name, who) => Object.values(preset(name).employees).find((e) => e.name === who).email;
let failed = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`); if (!ok) failed++; };
const plan = (year) => ({
  name: year.name, startDate: year.startDate, endDate: year.endDate, planningDeadline: year.planningEndsOn,
  plan: {
    reviewOpensOn: year.reviewOpensOn, resultsOutOn: year.resultsOutOn, midYearCheckInOn: year.midYearCheckInOn,
    selfReviewsDueOn: year.selfReviewsDueOn, calibrationOn: year.calibrationOn, joinersJoin: year.joinersJoin, droppedCompanyGoalIds: [],
  },
});

(async () => {
  const amira = await login(email("nextcycle", "Amira Khelifi"));
  const mariam = await login(email("nextcycle", "Mariam Gharbi"));
  const aicha = await login(email("nextcycle", "Aicha Bouazizi"));
  const elsewhere = await login(email("midyear", "Amira Khelifi"));

  const read = await call("GET", "/api/performance/cycles/setup", null, amira);
  const setup = read.json?.data;
  check("Amira reads the year's setup", read.status === 200 && Boolean(setup), `${read.status}`);
  check("next year waits as a draft", Boolean(setup?.draftId), setup?.year?.name);
  check("last year has ended, so it can launch", setup?.launchBlocker === null, `${setup?.lastYearName} ${setup?.lastYearPhase}`);
  check("who's in comes from Core HR", setup?.peopleCount > 0, `${setup?.peopleCount} people`);
  check("last year's company goals come along", (setup?.companyGoals ?? []).length > 0, `${setup?.companyGoals?.length}`);
  check("last year's unfinished goals are counted", typeof setup?.unfinishedGoals === "number", `${setup?.unfinishedGoals}`);

  for (const [who, token] of [["Mariam (manager)", mariam], ["Aicha (employee)", aicha]]) {
    check(`${who} can't read the setup`, (await call("GET", "/api/performance/cycles/setup", null, token)).status === 403);
    check(`${who} can't launch the year`,
      (await call("POST", `/api/performance/cycles/${setup.draftId}/launch`, { expectedVersion: setup.draftVersion }, token)).status === 403);
    check(`${who} can't change the year`,
      (await call("PUT", `/api/performance/cycles/${setup.draftId}`, { ...plan(setup.year), expectedVersion: setup.draftVersion }, token)).status === 403);
  }

  // Another company's administrator: the draft isn't there for them.
  check("another company's administrator can't launch it",
    (await call("POST", `/api/performance/cycles/${setup.draftId}/launch`, { expectedVersion: setup.draftVersion }, elsewhere)).status === 404);
  check("nor change it",
    (await call("PUT", `/api/performance/cycles/${setup.draftId}`, { ...plan(setup.year), expectedVersion: setup.draftVersion }, elsewhere)).status === 404);

  // On midyear this year runs: next year can be kept as a draft, but not launched.
  const theirs = (await call("GET", "/api/performance/cycles/setup", null, elsewhere)).json.data;
  check("mid-year, the setup says this year still runs", theirs.launchBlocker === "lastYearRunning", theirs.lastYearName);
  const kept = await call("POST", "/api/performance/cycles", plan(theirs.year), elsewhere);
  check("mid-year, next year is kept as a draft", kept.status === 200, `${kept.status}`);
  const draft = kept.json?.data;
  const refused = await call("POST", `/api/performance/cycles/${draft.id}/launch`, { expectedVersion: draft.version }, elsewhere);
  check("mid-year, it doesn't launch", refused.status === 409, `${refused.status} ${refused.json?.error?.message ?? ""}`);
  const gone = await call("DELETE", `/api/performance/cycles/${draft.id}`, { expectedVersion: draft.version }, elsewhere);
  check("the draft is deleted again", gone.status === 200, `${gone.status}`);

  console.log(failed ? `${failed} failed` : "all passed");
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
