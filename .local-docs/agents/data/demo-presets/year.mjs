// One Carthage performance year as dated steps (design D9–D11 of add-demo-presets-seeder). Every step is a product
// API call made by the person who would act, at its own moment: the timeline runs steps in date order with the demo
// clock set to that moment, and stops at `until` (the build's real now), so nothing is written in the future.
// Choices that vary between people (who is late, who is at risk, who rates high) are deterministic by employee index.
import crypto from "node:crypto";
import { as, clock } from "./client.mjs";

export const P = { AMIRA: 2, MARIAM: 5, OMAR: 6, LEILA: 21, KHALED: 22, RIM: 23, AICHA: 27 };

// ── Dates ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export const DAY = 86_400_000;
export const utcDay = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
export const addDays = (date, days) => new Date(date.getTime() + days * DAY);
export const ymd = (date) => date.toISOString().slice(0, 10);
const moment = (date, hour = 9, minute = 0) => new Date(utcDay(date).getTime() + (hour * 60 + minute) * 60_000).toISOString();
const daysBetween = (a, b) => Math.round((utcDay(b) - utcDay(a)) / DAY);

// ── Timeline ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** Steps in date order (a binary heap by moment, then insertion). Steps may schedule later steps. */
export class Timeline {
  constructor(until, log) { this.heap = []; this.seq = 0; this.until = until; this.log = log; this.ran = 0; this.batches = new Map(); }

  /** A step that may run side by side with the rest of its batch on the same day (no order among them). */
  addBatched(batch, when, label, run) {
    const key = `${batch} on ${when.slice(0, 10)}`;
    if (!this.batches.has(key)) this.batches.set(key, []);
    this.batches.get(key).push({ when, label, run });
  }

  add(when, label, run) {
    const item = { when, seq: this.seq++, label, run };
    const h = this.heap;
    h.push(item);
    for (let i = h.length - 1; i > 0;) {
      const parent = (i - 1) >> 1;
      if (this.#less(h[parent], h[i])) break;
      [h[parent], h[i]] = [h[i], h[parent]];
      i = parent;
    }
  }

  /** Independent steps (different people, their own moments) run side by side, `width` at a time, as one step. */
  addGroup(label, steps, width = 4) {
    if (!steps.length) return;
    const first = steps.reduce((a, b) => (a.when <= b.when ? a : b)).when;
    this.add(first, label, async () => {
      const queue = steps.filter((s) => s.when <= this.until);
      const worker = async () => {
        for (let step; (step = queue.shift());) {
          try { await clock.run(step.when, step.run); }
          catch (error) { throw new Error(`${step.when.slice(0, 16)} ${step.label}: ${error.message}`); }
          this.ran++;
        }
      };
      await Promise.all(Array.from({ length: width }, worker));
      this.ran--; // the group itself isn't a step
    });
  }

  #less(a, b) { return a.when < b.when || (a.when === b.when && a.seq < b.seq); }

  #pop() {
    const h = this.heap;
    const top = h[0];
    const last = h.pop();
    if (h.length) {
      h[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < h.length && this.#less(h[l], h[m])) m = l;
        if (r < h.length && this.#less(h[r], h[m])) m = r;
        if (m === i) break;
        [h[m], h[i]] = [h[i], h[m]];
        i = m;
      }
    }
    return top;
  }

  async run() {
    for (const [key, steps] of this.batches) this.addGroup(key, steps);
    this.batches.clear();
    let month = "";
    while (this.heap.length && this.heap[0].when <= this.until) {
      const step = this.#pop();
      clock.set(step.when);
      if (step.when.slice(0, 7) !== month) { month = step.when.slice(0, 7); this.log(`… ${month} (${this.ran} steps so far)`); }
      try { await step.run(); }
      catch (error) { throw new Error(`${step.when.slice(0, 16)} ${step.label}: ${error.message}`); }
      this.ran++;
    }
    clock.set(null);
    return this.ran;
  }
}

// ── Story material ─────────────────────────────────────────────────────────────────────────────────────────────────
const hash = (...parts) => crypto.createHash("md5").update(parts.join(":")).digest().readUInt32BE(0);

const COMPANY = [
  ["Build a resilient, secure cloud platform", "Improve platform resilience and secure delivery so teams can scale reliable digital products.", 99, "%"],
  ["Improve customer delivery predictability", "Increase delivery reliability and customer confidence across consulting and implementation work.", 90, "%"],
  ["Grow sustainable Tunisian digital capabilities", "Build the skills, collaboration and career pathways needed for lasting local technology growth.", 85, "%"],
];
const TEAM = {
  [P.MARIAM]: { title: "Cut production incidents by 40%", parent: 0, measurement: { method: "NumericTarget", baseline: 25, target: 15, unit: "incidents a quarter", direction: "Decrease" } },
  [P.OMAR]: { title: "Move every service to zero-downtime deploys", parent: 0, measurement: { method: "ManualPercentage" } },
  [P.AMIRA]: { title: "Make every team's growth plan visible", parent: 2, measurement: { method: "ManualPercentage" } },
};
const FIRST = [
  ["Deliver a reliable, secure product capability", 0, 100, "%"], ["Cut release lead time", 10, 4, "days"],
  ["Raise client satisfaction on delivered work", 70, 90, "CSAT"], ["Automate the regression suite", 20, 85, "% automated"],
  ["Close the year's audit findings", 0, 12, "findings"], ["Grow recurring client revenue", 0, 15, "% growth"],
];
const SECOND = ["Improve delivery flow and quality", "Make on-call calmer", "Document the team's runbooks",
  "Shorten code review turnaround", "Make estimates clients can rely on", "Share one practice with another team"];
const THIRD = ["Ship the release dashboard", "Run the platform migration", "Build role-relevant technical capability",
  "Stand up the analytics pipeline", "Roll out the new client onboarding"];
const MILESTONES = [["Plan agreed", 30, 75], ["First release", 30, 180], ["Handover", 40, 300]];
const NOTES = {
  AtRisk: ["Two dependencies slipped; recovering in the next sprint.", "Vendor API is late; the second half moves a month.",
    "Waiting on the security review before the next release."],
  OffTrack: ["The migration is blocked on the network change; replanning with the platform team.",
    "Lost two people to the client escalation; this objective needs a new date."],
};
const PRAISE = [
  "Kept two client releases on track while covering regression for another team.",
  "The incident drill was the best we have run. Clear roles, and every follow-up has an owner.",
  "Thank you for running the onboarding sessions. New joiners shipped in their first week.",
  "Your data pipeline fix saved the client demo. Quick, quiet and thorough.",
  "Moving three services to zero-downtime deploys in a month is real progress.",
];
const FEEDBACK = [
  "Your incident write-up was clear and blameless. The on-call team now uses it as the template.",
  "The milestone breakdown made the risk visible early. Keep flagging blockers this way.",
  "The client workshop ran long; a tighter agenda would have left time for decisions.",
  "Thanks for pairing on the flaky tests. The suite has been green all week.",
];

// Per objective: how the year goes. Most on track; Aicha's first objective is at risk; one of Mariam's people is off
// track on everything but is rated top (the rating that disagrees with its results).
function profile(ctx, index, objective) {
  if (index === P.AICHA && objective === 0) return "AtRisk";
  if (index === ctx.disagreeing) return "OffTrack";
  const h = hash("profile", index, objective) % 100;
  return h < 70 ? "OnTrack" : h < 88 ? "AtRisk" : h < 96 ? "OffTrack" : "Silent";
}

function rating(ctx, person) {
  if (person.index === ctx.disagreeing) return 5;
  if (person.index === P.AICHA) return 4;
  // A believable spread (about 10% 5, 30% 4, 45% 3, 13% 2, 2% 1), held at 3 for anyone with an objective off track.
  const h = hash("rating", person.index) % 100;
  let r = h < 10 ? 5 : h < 40 ? 4 : h < 85 ? 3 : h < 98 ? 2 : 1;
  if ([0, 1, 2].some((o) => profile(ctx, person.index, o) === "OffTrack")) r = Math.min(r, 3);
  if (person.managerIndex === P.OMAR) r = Math.min(5, r + 1); // the generous manager
  return r;
}

const POTENTIAL = ["Growing", "High", "Developing", "Growing", "Growing"];

// ── Context ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** People, lookups and the deterministic story choices shared by every year of a preset. */
export function storyContext(people) {
  const byIndex = (i) => people[i - 1];
  const reportsOf = (i) => people.filter((p) => p.managerIndex === i);
  const mariamsOthers = reportsOf(P.MARIAM).filter((p) => !Object.values(P).includes(p.index));
  return {
    people,
    byIndex,
    reportsOf,
    participants: people.filter((p) => p.index !== 1),
    reviewerOf: (p) => byIndex(p.managerIndex),
    disagreeing: mariamsOthers[0]?.index ?? null,
    amira: () => as(byIndex(P.AMIRA).email),
    values: [],
    praiseValues: [],
    cycles: {},
  };
}

/** Competencies the reviews rate (and growth goals and feedback name), and the company's values praise is tagged with; once per preset. */
export function companySetup(t, ctx, when) {
  const competencies = [
    ["Systems Thinking", "Connects product, platform and service decisions to wider business outcomes.", ["Identifies dependencies", "Balances near-term delivery with long-term sustainability"]],
    ["Secure Engineering", "Builds and operates technology with security and privacy built in.", ["Applies secure-by-design practices", "Raises risks early and follows through on remediation"]],
    ["Customer Partnership", "Works with clients and colleagues to shape useful, dependable digital outcomes.", ["Listens for underlying needs", "Sets clear expectations and closes feedback loops"]],
    ["Data-Informed Decision Making", "Uses relevant evidence to prioritize work and evaluate results.", ["Chooses meaningful measures", "Explains trade-offs and revises decisions when evidence changes"]],
    ["Inclusive Collaboration", "Creates conditions for diverse teams to contribute and deliver well together.", ["Shares context openly", "Invites and incorporates different perspectives"]],
  ];
  t.add(moment(when, 9), "Amira sets up the competencies", async () => {
    for (const [name, description, behaviors] of competencies)
      await ctx.amira().post("/api/performance/settings/competencies", { name, description, behaviors });
    ctx.values = (await ctx.amira().get("/api/performance/settings/competencies")).filter((c) => c.state === "Active").map((c) => c.id);
    ctx.praiseValues = (await ctx.amira().get("/api/performance/values")).map((v) => v.id);
  });
}

// ── A cycle ────────────────────────────────────────────────────────────────────────────────────────────────────────
const cycleVersion = async (session, cycle) => (await session.get(`/api/performance/cycles/${cycle.id}`)).cycle.version;

/** Draft with its steps planned and company objectives: ready to launch (everyone in Core HR with a manager is in). */
function prepareCycle(t, ctx, cycle, when) {
  t.add(moment(when, 9), `Amira prepares ${cycle.name}`, async () => {
    const amira = ctx.amira();
    const created = await amira.post("/api/performance/cycles", {
      name: cycle.name, startDate: ymd(cycle.start), endDate: ymd(cycle.end), planningDeadline: ymd(cycle.deadline),
      description: "Annual performance and growth cycle for Carthage Digital Group.",
      plan: {
        reviewOpensOn: ymd(cycle.round?.launch ?? addDays(cycle.end, -45)),
        resultsOutOn: ymd(cycle.round?.release ?? addDays(cycle.end, -14)),
        midYearCheckInOn: ymd(addDays(cycle.start, 182)), selfReviewsDueOn: null, calibrationOn: null,
        joinersJoin: true, droppedCompanyGoalIds: [],
      },
    });
    cycle.id = created.id ?? created.cycle?.id;
    cycle.base = `/api/performance/cycles/${cycle.id}`;
    cycle.strategy = [];
    for (const [title, description, target, unit] of COMPANY) {
      const objective = await amira.post(`${cycle.base}/strategy`, {
        title, description, accountablePersonId: ctx.byIndex(P.AMIRA).employeeId,
        startDate: ymd(cycle.start), endDate: ymd(cycle.end), publish: true, expectedVersion: await cycleVersion(amira, cycle),
        measurement: { method: "NumericTarget", baseline: 0, target, unit, direction: "Increase", milestones: [] },
      });
      cycle.strategy.push(objective.id);
    }
  });
}

/** A Draft for next year, its steps planned, so it launches with one click. */
export function draftCycle(t, ctx, cycle, when) {
  ctx.cycles[cycle.key] = cycle;
  prepareCycle(t, ctx, cycle, when);
}

/**
 * One cycle from preparation to wherever `until` stops it.
 * cycle: { key, name, start, end, deadline, cadence: 30|90, round?: { launch, selfDue, managerDue, calibration, release? },
 *          askUpdateAt? }. Nobody closes a year: it ends when the next one launches.
 */
export function runCycle(t, ctx, cycle) {
  ctx.cycles[cycle.key] = cycle;
  cycle.plans = {};
  prepareCycle(t, ctx, cycle, addDays(cycle.start, -10));
  // Launching ends the year before it (D-57), carrying its unfinished goals into their owners' drafts.
  t.add(moment(cycle.start, 8), `Amira launches ${cycle.name}`, async () => {
    const amira = ctx.amira();
    await amira.post(`${cycle.base}/launch`, { expectedVersion: await cycleVersion(amira, cycle) });
  });
  teamObjectives(t, ctx, cycle, addDays(cycle.start, 1));
  for (const person of ctx.participants) planning(t, ctx, cycle, person);
  checkIns(t, ctx, cycle);
  development(t, ctx, cycle);
  if (cycle.askUpdateAt) askForUpdate(t, ctx, cycle, cycle.askUpdateAt);
  if (cycle.round) reviewRound(t, ctx, cycle);
}

function teamObjectives(t, ctx, cycle, when) {
  cycle.team = {};
  t.add(moment(when, 11), "Amira publishes the team objectives", async () => {
    const amira = ctx.amira();
    for (const [ownerIndex, spec] of Object.entries(TEAM)) {
      const owner = ctx.byIndex(Number(ownerIndex));
      const me = (await as(owner.email).get("/api/corehr/workforce/me")).employee;
      const created = await amira.post(`${cycle.base}/goals`, {
        orgUnitId: me.orgUnit.orgUnitId, orgUnitName: me.orgUnit.name, title: spec.title, description: null,
        accountablePersonId: owner.employeeId, parentObjectiveId: cycle.strategy[spec.parent], startDate: null, endDate: null,
        progressSource: "Direct", measurement: spec.measurement, expectedVersion: await cycleVersion(amira, cycle),
      });
      await amira.post(`${cycle.base}/goals/${created.node.id}/publish`, { expectedVersion: created.node.version });
      cycle.team[ownerIndex] = created.node.id;
    }
  });
}

function objectivesFor(ctx, cycle, person) {
  const first = FIRST[hash("first", person.index) % FIRST.length];
  const parent = cycle.team[person.managerIndex] ?? cycle.strategy[person.index % 3];
  return [
    { title: first[0], description: null, parentObjectiveId: parent, startDate: null, endDate: null, planWeight: 40,
      measurement: { method: "NumericTarget", baseline: first[1], target: first[2], unit: first[3], direction: first[2] >= first[1] ? "Increase" : "Decrease", milestones: [] } },
    { title: SECOND[hash("second", person.index) % SECOND.length], description: null, startDate: null, endDate: null,
      // About two in five also tie their second objective to company direction.
      parentObjectiveId: hash("aligned2", person.index) % 5 < 2 ? cycle.strategy[(person.index + 1) % 3] : null,
      planWeight: 35, measurement: { method: "ManualPercentage" } },
    { title: THIRD[hash("third", person.index) % THIRD.length], description: null, parentObjectiveId: null, startDate: null, endDate: null,
      planWeight: 25, measurement: { method: "WeightedMilestones", milestones: MILESTONES.map(([title, weight, at]) => ({ title, weight, dueDate: ymd(addDays(cycle.start, at)) })) } },
  ];
}

/** Each person writes, submits and gets their plan approved; some are returned once, a few approved late. */
function planning(t, ctx, cycle, person) {
  const i = person.index;
  const s = cycle.start;
  // Personas follow the planning preset's story; everyone else spreads over the window.
  const fixed = {
    [P.AICHA]: { write: 3, submit: 10, decide: 14 },
    [P.LEILA]: { write: 4, submit: 20, decide: 22 },
    [P.RIM]: { write: 2, submit: 5, decide: 6 },
    [P.KHALED]: { write: 3, submit: 7, decide: 9, returned: true, address: 16 },
  }[i];
  const late = hash("late", i) % 10;
  const plan = fixed ?? {
    write: late === 0 ? 20 : 2 + (i % 8),
    submit: late === 0 ? 24 : late === 1 ? 26 : 2 + (i % 8) + 1 + (i % 12),
    returned: hash("returned", i) % 7 === 3,
  };
  plan.decide ??= hash("approvedLate", i) % 13 === 5 ? daysBetween(s, cycle.deadline) + 3 : plan.submit + 1 + (i % 3);
  plan.address ??= plan.decide + 1;
  const hour = 9 + (i % 8);
  const base = () => cycle.base;
  const me = as(person.email);
  const reviewer = () => as(ctx.reviewerOf(person).email);

  t.addBatched(`${cycle.name} plans`, moment(addDays(s, plan.write), hour), `${person.name} writes a plan`, async () => {
    let written = await me.post(`${base()}/plan`, { expectedVersion: await cycleVersion(me, cycle) });
    // Goals carried from last year wait in the draft; this cast writes its own year, so they drop them.
    for (const carried of written.objectives ?? [])
      written = await me.call("DELETE", `${base()}/plan/objectives/${carried.id}`, { expectedVersion: written.version });
    for (const objective of objectivesFor(ctx, cycle, person))
      written = await me.post(`${base()}/plan/objectives`, { ...objective, expectedVersion: written.version });
    cycle.plans[i] = written.id;
  });
  t.addBatched(`${cycle.name} plans`, moment(addDays(s, plan.submit), hour, 30), `${person.name} submits`, async () => {
    const { plan: current } = await me.get(`${base()}/plan`);
    await me.post(`${base()}/plan/submit`, { expectedVersion: current.version });
  });
  if (plan.returned) {
    t.addBatched(`${cycle.name} plans`, moment(addDays(s, plan.decide), 15), `${ctx.reviewerOf(person).name} returns ${person.name}'s plan`, async () => {
      const current = await reviewer().get(`${base()}/plans/${cycle.plans[i]}`);
      await reviewer().post(`${base()}/plans/${current.id}/return`, {
        feedback: "Close, but make the second objective measurable.", expectedVersion: current.version,
        changeRequests: [{ objectiveId: current.objectives[1].id, text: "Say what done looks like, and by when." }],
      });
    });
    t.addBatched(`${cycle.name} plans`, moment(addDays(s, plan.address), 11), `${person.name} addresses the change request and resubmits`, async () => {
      let { plan: current } = await me.get(`${base()}/plan`);
      for (const request of current.history.at(-1)?.changeRequests ?? [])
        current = await me.post(`${base()}/plan/change-requests/${request.id}/address`, { reply: "Added a measure and a date.", expectedVersion: current.version });
      await me.post(`${base()}/plan/submit`, { expectedVersion: current.version });
    });
    plan.decide = plan.address + 1;
  }
  t.addBatched(`${cycle.name} plans`, moment(addDays(s, plan.decide), 16), `${ctx.reviewerOf(person).name} approves ${person.name}'s plan`, async () => {
    const current = await reviewer().get(`${base()}/plans/${cycle.plans[i]}`);
    await reviewer().post(`${base()}/plans/${current.id}/approve`, { expectedVersion: current.version });
  });
}

function progressInput(ctx, cycle, person, index, objective, progress, when) {
  const kind = profile(ctx, person.index, index);
  const elapsed = Math.min(1, daysBetween(cycle.start, when) / daysBetween(cycle.start, cycle.end));
  const early = daysBetween(cycle.start, when) < 75;
  const status = kind === "OnTrack" ? "OnTrack" : kind === "AtRisk" ? (early ? "OnTrack" : "AtRisk") : (early ? "AtRisk" : "OffTrack");
  const pct = Math.min(100, Math.round(100 * elapsed * (status === "OnTrack" ? 1.05 : status === "AtRisk" ? 0.75 : 0.45)));
  const note = status === "OnTrack" ? null : NOTES[status][hash("note", person.index, index, when) % NOTES[status].length];
  const body = { expectedVersion: progress.version, percentage: null, numericActual: null, milestones: null, status, contextNote: note, isCorrection: false, evidence: [] };
  const m = objective.measurement ?? {};
  if (m.method === "NumericTarget") body.numericActual = Math.round((m.baseline + ((m.target - m.baseline) * pct) / 100) * 10) / 10;
  else if (m.method === "WeightedMilestones") {
    const due = (progress.milestones ?? []).filter((x) => !x.isCompleted && x.dueDate && x.dueDate <= ymd(when));
    const done = status === "OffTrack" ? due.slice(0, (progress.milestones ?? []).every((x) => !x.isCompleted) ? 1 : 0) : due;
    // Nothing newly due: a status-only check-in.
    if (done.length) body.milestones = done.map((x) => ({ milestoneId: x.id, completed: true }));
  } else body.percentage = pct;
  return body;
}

/**
 * Records one check-in. A 409 after a dropped connection usually means the first try landed: if the newest entry is at
 * this step's moment it did; otherwise someone else wrote in between and it is written again on the fresh version.
 */
async function record(me, route, body) {
  const progress = await me.get(route);
  try { await me.post(route, body(progress)); }
  catch (error) {
    if (error.status !== 409) throw error;
    const fresh = await me.get(route);
    if (fresh.history?.[0]?.recordedAt?.slice(0, 16) === clock.get().slice(0, 16)) return;
    await me.post(route, body(fresh));
  }
}

/** Check-ins every `cadence` days from 45 days in until two weeks before the end, by every person with an approved plan. */
function checkIns(t, ctx, cycle) {
  const last = addDays(cycle.end, -14);
  for (let offset = 45, k = 0; addDays(cycle.start, offset) <= last; offset += cycle.cadence, k++) {
    const when = addDays(cycle.start, offset);
    const round = [];
    const add = (at, label, run) => round.push({ when: at, label, run });
    for (const person of ctx.participants) {
      // About one in eleven people (never a persona) lets a round pass without a check-in.
      if (!Object.values(P).includes(person.index) && hash("skip", person.index, k) % 100 < 9) continue;
      const me = as(person.email);
      add(moment(addDays(when, person.index % 4), 9 + (person.index % 8), 15), `${person.name} checks in`, async () => {
        const { plan } = await me.get(`${cycle.base}/plan`);
        if (plan?.state !== "Approved") return;
        for (const [index, objective] of plan.objectives.entries()) {
          if (profile(ctx, person.index, index) === "Silent") continue;
          const route = `${cycle.base}/objectives/${objective.id}/progress`;
          await record(me, route, (progress) => progressInput(ctx, cycle, person, index, objective, progress, when));
        }
      });
    }
    // Team objective owners report on their team objective at the same rhythm.
    for (const ownerIndex of Object.keys(TEAM)) {
      const owner = ctx.byIndex(Number(ownerIndex));
      add(moment(when, 17), `${owner.name} checks in on the team objective`, async () => {
        const route = `${cycle.base}/objectives/${cycle.team[ownerIndex]}/progress`;
        const status = ownerIndex === String(P.OMAR) && offset > 120 ? "AtRisk" : "OnTrack";
        const pct = Math.min(100, Math.round((100 * offset) / daysBetween(cycle.start, cycle.end)));
        const m = TEAM[ownerIndex].measurement;
        await record(as(owner.email), route, (progress) => ({
          expectedVersion: progress.version, milestones: null, isCorrection: false, evidence: [], status,
          contextNote: status === "AtRisk" ? "The load balancer migration slipped; three services still deploy with downtime." : null,
          percentage: m.method === "ManualPercentage" ? pct : null,
          numericActual: m.method === "NumericTarget" ? Math.round(m.baseline + ((m.target - m.baseline) * pct) / 100) : null,
        }));
      });
    }
    t.addGroup(`${cycle.name} check-ins from ${ymd(when)}`, round);
  }
}

/** A few development goals for the personas early in the year; one moves to in progress later. */
function development(t, ctx, cycle) {
  const goals = {
    [P.AICHA]: [["Lead a client release end to end", 2], ["Present the test automation approach at the guild", 1]],
    [P.LEILA]: [["Coach two new product analysts", 4]],
    [P.RIM]: [["Get the cloud security certification", 1]],
    [P.KHALED]: [["Mentor two new platform engineers", 4]],
  };
  for (const [index, list] of Object.entries(goals)) {
    const person = ctx.byIndex(Number(index));
    const route = () => `${cycle.base}/people/${person.employeeId}/development`;
    t.add(moment(addDays(cycle.start, 40), 14), `${person.name} adds development goals`, async () => {
      for (const [title, value] of list) {
        const current = await as(person.email).get(route());
        await as(person.email).post(`${route()}/goals`, {
          title, competencyId: ctx.values[value % ctx.values.length] ?? null, actions: ["Agree the scope with my manager"],
          targetDate: ymd(addDays(cycle.start, 300)), status: "NotStarted", expectedVersion: current.version,
        });
      }
    });
    t.add(moment(addDays(cycle.start, 150), 14), `${person.name} starts a development goal`, async () => {
      const current = await as(person.email).get(route());
      const goal = current.goals?.[0];
      if (!goal) return;
      await as(person.email).put(`${route()}/goals/${goal.id}`, {
        title: goal.title, competencyId: goal.competencyId ?? null, actions: goal.actions ?? [], targetDate: goal.targetDate ?? null,
        status: "InProgress", expectedVersion: current.version,
      });
    });
  }
}

function askForUpdate(t, ctx, cycle, when) {
  t.add(moment(when, 11), "Mariam asks Aicha for an update", async () => {
    const mariam = as(ctx.byIndex(P.MARIAM).email);
    const plan = await mariam.get(`${cycle.base}/plans/${cycle.plans[P.AICHA]}`);
    await mariam.post(`${cycle.base}/plans/${plan.id}/update-requests`, { objectiveId: plan.objectives[1].id, note: "Where is this at after the client escalation?" });
  });
}

// ── The Year-end round ─────────────────────────────────────────────────────────────────────────────────────────────
const PEERS = { [P.AICHA]: [P.LEILA, P.KHALED, P.RIM], [P.LEILA]: [P.RIM, P.AICHA, P.KHALED], [P.MARIAM]: [P.OMAR, P.LEILA, P.RIM] };
const PEER_WORDS = [
  "Turns vague bug reports into tests that fail for the right reason.",
  "Share plans earlier; we found out about the vendor delay from the release notes.",
  "Calm in release week. People go to her when the build is red.",
];

/**
 * Round dates: launch, selfDue, managerDue; `release` (when set) runs calibration, release, acknowledgements and the
 * round's close; without it the round is left running (the year-end preset).
 */
/**
 * Drafts the Year-end round with its questions, competencies and peers; `r` carries selfDue/managerDue (or opensOn, when
 * the round opens by itself and its due dates follow from that day). Anyone without an active reviewer is left out.
 */
async function setUpRound(ctx, cycle, r, periodEnd) {
  const amira = ctx.amira();
  const created = await amira.post(`${cycle.base}/review-rounds`, { name: "Year-end review", periodStart: ymd(cycle.start), periodEnd: ymd(periodEnd) });
  r.id = created.id;
  const library = await amira.get("/api/performance/settings/review-questions");
  const pick = (audience, n) => library.filter((q) => q.audience === audience && q.state === "Active").slice(0, n).map((q) => q.id);
  const competencies = (await amira.get("/api/performance/settings/competencies")).filter((c) => c.state === "Active").map((c) => c.id);
  let round = await amira.get(`/api/performance/review-rounds/${r.id}`);
  round = await amira.put(`/api/performance/review-rounds/${r.id}`, {
    expectedVersion: round.version, name: "Year-end review", periodStart: round.periodStart, periodEnd: round.periodEnd,
    selfAssessmentEnabled: true, objectiveRatingsEnabled: true, calibrationEnabled: true,
    selfAssessmentDueDate: r.selfDue ? ymd(r.selfDue) : null, managerAssessmentDueDate: r.managerDue ? ymd(r.managerDue) : null,
    ...(r.opensOn ? { opensOn: ymd(r.opensOn) } : {}), competencyIds: competencies,
    peerInputEnabled: true, questionsEnabled: true, potentialEnabled: true,
    questionIds: [...pick("Person", 3), ...pick("Manager", 2), ...pick("Peer", 3)],
  });
  const blocked = round.subjects.filter((s) => !s.isExcluded && s.readinessIssues?.length);
  if (blocked.length) await amira.put(`/api/performance/review-rounds/${r.id}/population`, {
    expectedVersion: round.version,
    subjects: blocked.map((s) => ({ participantId: s.participantId, isExcluded: true, exclusionReason: "No active reviewer this cycle", reviewerEmployeeId: s.reviewerEmployeeId })),
  });
}

/** A Year-end round drafted ahead, opening by itself on `opensOn` (or the day HR opens it): the one-sitting preset's. */
export function draftRound(t, ctx, cycle, when, opensOn) {
  cycle.round = { opensOn };
  t.add(moment(when, 10), `Amira drafts the Year-end review of ${cycle.name}`, () => setUpRound(ctx, cycle, cycle.round, opensOn));
}

function reviewRound(t, ctx, cycle) {
  const r = cycle.round;
  const amira = () => ctx.amira();
  r.reviews = {};
  t.add(moment(addDays(r.launch, -2), 10), `Amira sets up the Year-end review of ${cycle.name}`, () => setUpRound(ctx, cycle, r, r.launch));
  t.add(moment(r.launch, 9), "Amira launches the Year-end review", async () => {
    const round = await amira().get(`/api/performance/review-rounds/${r.id}`);
    await amira().post(`/api/performance/review-rounds/${r.id}/launch`, { expectedVersion: round.version });
  });

  const reviewOf = async (person) => (r.reviews[person.index] ??= (await as(person.email).get(`/api/performance/reviews/workspace?cycle=${cycle.id}`)).own?.reviewId);

  // Peers: Fusion asks three at launch (D-40); for the personas the manager sets who the story needs the day after.
  for (const [subjectIndex, peers] of Object.entries(PEERS)) {
    const subject = ctx.byIndex(Number(subjectIndex));
    t.add(moment(addDays(r.launch, 1), 10), `${ctx.reviewerOf(subject).name} sets ${subject.name}'s peers`, async () => {
      const reviewer = as(ctx.reviewerOf(subject).email);
      const review = await reviewer.get(`/api/performance/reviews/${await reviewOf(subject)}`);
      if (review.canChangePeers) await reviewer.put(`/api/performance/reviews/${review.id}/peers`,
        { expectedVersion: review.version, employeeIds: peers.map((p) => ctx.byIndex(p).employeeId) });
    });
    peers.forEach((peerIndex, n) => {
      const peer = ctx.byIndex(peerIndex);
      t.add(moment(addDays(r.launch, 3 + n), 15), `${peer.name} answers about ${subject.name}`, async () => {
        const ask = (await as(peer.email).get(`/api/performance/reviews/workspace?cycle=${cycle.id}`)).askedOfYou
          .find((a) => a.subjectDisplayName === subject.name && a.state === "Open");
        if (!ask) return;
        const request = await as(peer.email).get(`/api/performance/peer-requests/${ask.requestId}`);
        await as(peer.email).post(`/api/performance/peer-requests/${request.id}/send`,
          { answers: request.questions.map((q, i) => ({ questionId: q.questionId, text: PEER_WORDS[(i + n) % PEER_WORDS.length] })) });
      });
    });
  }

  // Self-assessments over the window; while the round is still running, about one in five is left to write, Aicha's
  // among them. Each reviewer writes the review the same afternoon.
  const window = Math.max(2, daysBetween(r.launch, r.selfDue) - 1);
  for (const person of ctx.participants) {
    const holdBack = !r.release && (person.index === P.AICHA || hash("selfLate", person.index) % 100 < 19);
    const selfDay = holdBack ? addDays(r.selfDue, 1) : addDays(r.launch, 1 + (hash("self", person.index) % Math.min(window, 9)));
    const me = as(person.email);
    t.add(moment(selfDay, 10 + (person.index % 6)), `${person.name} self-assesses`, async () => {
      const id = await reviewOf(person);
      if (!id) return;
      const review = await me.get(`/api/performance/reviews/${id}`);
      if (!review.canEditSelfAssessment) return;
      const own = Math.min(5, rating(ctx, person) + (hash("selfHigh", person.index) % 3 === 0 ? 1 : 0));
      await me.post(`/api/performance/reviews/${id}/self-assessment`, {
        expectedVersion: review.version, summary: "Most of what I set out to do landed; one objective moves to next year.", overallRating: own,
        items: review.items.map((item) => ({ kind: item.kind, itemId: item.itemId, rating: own,
          ...(item.kind === "Objective" ? { reflection: "Delivered the main milestones; the last one waits on another team." } : {}) })),
        answers: review.questions.filter((q) => q.audience === "Person").map((q) => ({ questionId: q.questionId, text: "Taking a release from plan to production." })),
      });
    });
    // In a round that runs to release, a few reviews come in the day after they were due, still before calibration.
    const late = r.release && !Object.values(P).includes(person.index) && hash("managerLate", person.index) % 100 < 7;
    t.add(late ? moment(addDays(r.managerDue, 1), 8) : moment(selfDay, 17, 30), `${ctx.reviewerOf(person).name} reviews ${person.name}`, async () => {
      const reviewer = as(ctx.reviewerOf(person).email);
      const id = await reviewOf(person);
      if (!id) return;
      const review = await reviewer.get(`/api/performance/reviews/${id}`);
      if (!review.canEditManagerAssessment) return;
      const value = rating(ctx, person);
      await reviewer.post(`/api/performance/reviews/${id}/manager-assessment`, {
        expectedVersion: review.version, overallRating: value,
        summary: value >= 4 ? "A strong year: delivered what mattered and lifted the team around them." : "Met most of the role; the hardest objective is still open.",
        potential: review.potentialEnabled ? POTENTIAL[hash("potential", person.index) % POTENTIAL.length] : null,
        items: review.items.map((item) => ({ kind: item.kind, itemId: item.itemId, rating: value, assessment: "Consistent across the year." })),
        answers: review.questions.filter((q) => q.audience === "Manager").map((q) => ({ questionId: q.questionId, text: "Keep owning releases end to end." })),
      });
    });
  }
  if (!r.release) return;

  // Calibration by exception (D-35): Amira looks only at the flagged reviews, brings Omar's flagged top ratings down
  // with a reason and keeps the rest; then releases every review, people acknowledge over a week, and the round closes.
  const R = r.release;
  const calibration = () => `/api/performance/review-rounds/${r.id}/calibration`;
  t.add(moment(addDays(R, -4), 14), "Amira looks at the flagged reviews", async () => {
    const { flagged } = await amira().get(calibration());
    for (const card of flagged.filter((c) => !c.decision)) {
      const generous = card.reviewerEmployeeId === ctx.byIndex(P.OMAR).employeeId && card.rating === 5;
      await amira().put(`${calibration()}/subjects/${card.reviewId}/decision`, generous
        ? { rating: 4, reason: "Strong delivery, but the year's main goal is behind; 4 reflects it.", expectedVersion: card.version }
        : { rating: card.rating, reason: null, expectedVersion: card.version });
    }
  });
  t.add(moment(R, 9), "Amira releases the results", async () => {
    const round = await amira().get(`/api/performance/review-rounds/${r.id}`);
    await amira().post(`/api/performance/review-rounds/${r.id}/finalize`, { expectedVersion: round.version });
  });
  for (const person of ctx.participants) {
    if (hash("noAck", person.index) % 10 === 0 && person.index !== P.AICHA) continue; // about one in ten never acknowledges
    t.add(moment(addDays(R, 1 + (hash("ack", person.index) % 6)), 11), `${person.name} acknowledges`, async () => {
      const id = await reviewOf(person);
      if (id) await as(person.email).post(`/api/performance/reviews/${id}/acknowledge`, { comment: hash("ackNote", person.index) % 3 ? null : "Thanks. Agreed on the focus for next year." });
    });
  }
  // The round closes itself once results are out (B-405 slice 2); nothing to close by hand.
}

// ── Conversations across the whole preset ──────────────────────────────────────────────────────────────────────────
/** 1:1s, feedback, a feedback request and praise from `from` to `today`; the 1:1 that falls today stays upcoming. */
export function conversations(t, ctx, from, today) {
  const pairs = [[P.MARIAM, P.AICHA, "EveryTwoWeeks", 14], [P.MARIAM, P.AMIRA, "Weekly", 7], [P.AMIRA, P.OMAR, "Monthly", 28]];
  for (const [managerIndex, otherIndex, cadence, step] of pairs) {
    const manager = ctx.byIndex(managerIndex), other = ctx.byIndex(otherIndex);
    const meetings = Math.floor(daysBetween(from, today) / step);
    const first = addDays(today, -step * meetings); // a meeting lands on today for the fortnightly and weekly pairs
    const startAt = addDays(first, -3);
    const series = {};
    t.add(moment(startAt, 9), `${manager.name} starts 1:1s with ${other.name}`, async () => {
      const started = await as(manager.email).post("/api/performance/one-on-ones",
        { withEmployeeId: other.employeeId, cadence, firstMeetingAt: moment(first, 10) });
      series.id = started.id;
      scheduleMeeting(started.upcoming);
    });
    let n = 0;
    const scheduleMeeting = (upcoming) => {
      if (!upcoming || upcoming.scheduledAt.slice(0, 10) >= ymd(today)) return;
      const at = new Date(upcoming.scheduledAt);
      const k = n++;
      const itemId = crypto.randomUUID();
      t.add(new Date(at.getTime() - 20 * 3_600_000).toISOString(), `${other.name} adds to the 1:1 agenda`, async () => {
        await as(other.email).post(`/api/performance/one-on-ones/meetings/${upcoming.id}/agenda`,
          { id: itemId, text: ["Release plan for next month", "Training budget", "Workload this sprint", "Feedback from the client"][k % 4] });
      });
      // A 1:1 lasts 30 minutes and completes itself; its notes stay open until the next one (slice 6).
      t.add(new Date(at.getTime() + 45 * 60_000).toISOString(), `${manager.name} holds the 1:1 with ${other.name}`, async () => {
        const m = `/api/performance/one-on-ones/meetings/${upcoming.id}`;
        let current = await as(manager.email).put(`${m}/agenda/${itemId}/note`,
          { text: ["Agreed the next two releases and who owns each.", "Talked through the estimate; Aicha brings the numbers next time.", "Good month. Two blockers raised, both with owners."][k % 3], expectedRevision: 0 });
        for (const action of (current.actions ?? current.upcoming?.actions ?? []).filter((a) => !a.doneAt && a.ownerEmployeeId === other.employeeId))
          current = await as(other.email).put(`/api/performance/one-on-ones/${series.id}/actions/${action.id}/done`, { done: true });
        if (k % 2 === 0) await as(manager.email).post(`/api/performance/one-on-ones/${series.id}/actions`,
          { id: crypto.randomUUID(), text: "Share the revised estimate with the client", ownerEmployeeId: other.employeeId, dueDate: ymd(addDays(at, 5)) });
        const latest = await as(manager.email).get(`/api/performance/one-on-ones/${series.id}`);
        scheduleMeeting(latest.upcoming?.id === upcoming.id ? null : latest.upcoming);
      });
    };
  }

  // Feedback and praise: a few each month among the personas and Mariam's team.
  const circle = [P.AICHA, P.LEILA, P.KHALED, P.RIM, P.MARIAM, P.OMAR, P.AMIRA, ...ctx.reportsOf(P.MARIAM).map((p) => p.index)]
    .filter((v, i, all) => all.indexOf(v) === i);
  for (let d = addDays(from, 10), k = 0; d < today; d = addDays(d, 9), k++) {
    const giver = ctx.byIndex(circle[hash("giver", k) % circle.length]);
    const others = circle.filter((x) => x !== giver.index);
    const receiver = ctx.byIndex(others[hash("receiver", k) % others.length]);
    if (k % 3 === 2) {
      const extra = ctx.byIndex(others[(hash("receiver", k) + 1) % others.length]);
      t.add(moment(d, 15), `${giver.name} praises ${receiver.name}`, async () => {
        await as(giver.email).post("/api/performance/praise", {
          id: crypto.randomUUID(), recipientEmployeeIds: k % 2 ? [receiver.employeeId] : [receiver.employeeId, extra.employeeId],
          valueId: ctx.praiseValues[k % ctx.praiseValues.length], message: PRAISE[k % PRAISE.length],
        });
      });
    } else {
      t.add(moment(d, 16), `${giver.name} gives ${receiver.name} feedback`, async () => {
        await as(giver.email).post("/api/performance/feedback", {
          id: crypto.randomUUID(), receiverEmployeeId: receiver.employeeId, visibility: k % 5 === 1 ? "ManagerOnly" : "Shared",
          competencyId: k % 2 ? ctx.values[k % ctx.values.length] : null, message: FEEDBACK[k % FEEDBACK.length],
        });
      });
    }
  }
}

/** Everyone reads what they had by `when`, so the bell shows only the last days. */
export function readNotifications(t, ctx, when) {
  t.add(moment(when, 18), "Everyone reads their notifications", async () => {
    for (const person of ctx.people) await as(person.email).post("/api/performance/notifications/read", { all: true });
  });
}
