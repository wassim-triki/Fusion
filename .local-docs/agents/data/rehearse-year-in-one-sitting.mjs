// B-395: rehearses the one-sitting demo on the `sitting` preset, through the product API as the presenters would act,
// on today's real clock: Planning → Execution → Review → Results out → next year launched (this one ended).
//   node .local-docs/agents/data/demo-preset.mjs reset sitting
//   node .local-docs/agents/data/rehearse-year-in-one-sitting.mjs
// It spends the tenant: rebuild it (`reset sitting`) before the real demo. Each move prints what the Year says after it;
// the first refusal stops the run with the API's own error.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { as } from "./demo-presets/client.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await fs.readFile(path.join(here, "demo-presets.local.json"), "utf8"));
const preset = manifest.presets.sitting;
if (!preset) throw new Error("The sitting preset isn't built: node .local-docs/agents/data/demo-preset.mjs build sitting");

const persona = (first) => preset.personas.find((p) => p.name.startsWith(first)).email;
const amira = as(persona("Amira"));
const mariam = as(persona("Mariam"));
const aicha = as(persona("Aicha"));
const cycleId = preset.cycles.current.id;
const base = `/api/performance/cycles/${cycleId}`;

let step = 0;
async function act(label, run) {
  step++;
  try {
    const said = await run();
    console.log(`✓ ${String(step).padStart(2)} ${label}${said ? ` — ${said}` : ""}`);
  } catch (error) {
    console.log(`✗ ${String(step).padStart(2)} ${label}\n     ${error.message}`);
    process.exit(1);
  }
}

const year = (who = amira) => who.get(`${base}/year`);
const describe = (y) => `${y.name} at ${y.phase}${y.nextMove ? `; next ${y.nextMove.to} (${y.nextMove.canMove ? `${y.nextMove.affected} affected` : `blocked: ${y.nextMove.blocker}`})` : ""}`;
async function moveOn(to) {
  const before = await year();
  if (before.nextMove?.to !== to) throw new Error(`the Year offers ${before.nextMove?.to ?? "nothing"}, not ${to} (${describe(before)})`);
  if (!before.nextMove.canMove) throw new Error(`the move to ${to} is blocked: ${before.nextMove.blocker}`);
  const after = await amira.post(`${base}/move-on`, { to, expectedVersion: before.version });
  if (after.phase !== to) throw new Error(`moved, but the Year reads ${after.phase}`);
  return describe(after);
}
const ownReview = async (who) => (await who.get(`/api/performance/reviews/workspace?cycle=${cycleId}`)).own?.reviewId;

console.log(`${preset.name} (${preset.domain}, built ${preset.runDate})\n`);

await act("Amira opens the Year", async () => describe(await year()));

// ── Planning ─────────────────────────────────────────────────────────────────────────────────────────────────────────
await act("Mariam approves Aicha's plan", async () => {
  const id = (await aicha.get(`${base}/plan`)).plan.id;
  const plan = await mariam.get(`${base}/plans/${id}`);
  if (plan.state !== "Submitted") throw new Error(`Aicha's plan is ${plan.state}, not Submitted`);
  const approved = await mariam.post(`${base}/plans/${id}/approve`, { expectedVersion: plan.version });
  return approved.state;
});
await act("Amira closes planning", () => moveOn("Execution"));

// ── Execution ────────────────────────────────────────────────────────────────────────────────────────────────────────
await act("Aicha updates a goal", async () => {
  const { plan } = await aicha.get(`${base}/plan`);
  const objective = plan.objectives.find((o) => o.measurement?.method === "ManualPercentage") ?? plan.objectives[0];
  const route = `${base}/objectives/${objective.id}/progress`;
  const progress = await aicha.get(route);
  const m = objective.measurement ?? {};
  await aicha.post(route, {
    expectedVersion: progress.version, status: "OnTrack", contextNote: null, isCorrection: false, evidence: [], milestones: null,
    percentage: m.method === "ManualPercentage" ? 40 : null,
    numericActual: m.method === "NumericTarget" ? m.baseline + (m.target - m.baseline) * 0.4 : null,
  });
  return objective.title;
});
await act("Amira opens the Year-end review today", () => moveOn("Review"));

// ── Review ───────────────────────────────────────────────────────────────────────────────────────────────────────────
let aichasReview;
await act("Aicha writes her self-review", async () => {
  aichasReview = await ownReview(aicha);
  if (!aichasReview) throw new Error("Aicha has no review in the round");
  const review = await aicha.get(`/api/performance/reviews/${aichasReview}`);
  if (!review.canEditSelfAssessment) throw new Error("the self-review isn't open to her");
  await aicha.post(`/api/performance/reviews/${aichasReview}/self-assessment`, {
    expectedVersion: review.version, summary: "The release work landed; the regression suite moves to next year.", overallRating: 4,
    items: review.items.map((item) => ({ kind: item.kind, itemId: item.itemId, rating: 4,
      ...(item.kind === "Objective" ? { reflection: "Delivered the main milestones." } : {}) })),
    answers: review.questions.filter((q) => q.audience === "Person").map((q) => ({ questionId: q.questionId, text: "Taking a release from plan to production." })),
  });
  return `${review.items.length} items`;
});
await act("Mariam writes Aicha's review", async () => {
  const review = await mariam.get(`/api/performance/reviews/${aichasReview}`);
  if (!review.canEditManagerAssessment) throw new Error("the manager's review isn't open to Mariam");
  await mariam.post(`/api/performance/reviews/${aichasReview}/manager-assessment`, {
    expectedVersion: review.version, overallRating: 4, summary: "A strong year: she delivered what mattered and lifted the team.",
    potential: review.potentialEnabled ? "High" : null,
    items: review.items.map((item) => ({ kind: item.kind, itemId: item.itemId, rating: 4, assessment: "Consistent across the year." })),
    answers: review.questions.filter((q) => q.audience === "Manager").map((q) => ({ questionId: q.questionId, text: "Keep owning releases end to end." })),
  });
  return "submitted";
});
await act("Amira looks at calibration", async () => {
  const y = await year();
  const roundId = y.review?.roundId ?? y.nextMove?.roundId;
  if (!roundId) return "no round on the Year";
  const { flagged } = await amira.get(`/api/performance/review-rounds/${roundId}/calibration`);
  for (const card of flagged.filter((c) => !c.decision))
    await amira.put(`/api/performance/review-rounds/${roundId}/calibration/subjects/${card.reviewId}/decision`, { rating: card.rating, reason: null, expectedVersion: card.version });
  return `${flagged.length} flagged`;
});
await act("Amira releases the results", async () => {
  const y = await year();
  const release = y.nextMove?.release;
  const said = await moveOn("ResultsOut");
  return `${said}; ${release ? `${release.asRated} as rated, ${release.toLookAt} to look at, ${release.stillWriting} still being written` : ""}`;
});

// ── Results out ──────────────────────────────────────────────────────────────────────────────────────────────────────
await act("Aicha reads and acknowledges her results", async () => {
  const review = await aicha.get(`/api/performance/reviews/${aichasReview}`);
  await aicha.post(`/api/performance/reviews/${aichasReview}/acknowledge`, { comment: "Thanks. Agreed on the focus for next year." });
  return `rated ${review.finalRating ?? review.managerAssessment?.overallRating ?? "?"}`;
});
await act("Mariam sees the results on her Year", async () => describe(await year(mariam)));

// ── Next year ────────────────────────────────────────────────────────────────────────────────────────────────────────
let next;
await act("Amira sets up next year", async () => {
  let setup = await amira.get("/api/performance/cycles/setup");
  if (!setup.draftId) {
    const y = setup.year;
    await amira.post("/api/performance/cycles", {
      name: y.name, startDate: y.startDate, endDate: y.endDate, planningDeadline: y.planningEndsOn,
      plan: { reviewOpensOn: y.reviewOpensOn, resultsOutOn: y.resultsOutOn, midYearCheckInOn: y.midYearCheckInOn, selfReviewsDueOn: y.selfReviewsDueOn,
        calibrationOn: y.calibrationOn, joinersJoin: y.joinersJoin, droppedCompanyGoalIds: y.droppedCompanyGoalIds },
    });
    setup = await amira.get("/api/performance/cycles/setup");
  }
  if (setup.launchBlocker) throw new Error(`launch blocked: ${setup.launchBlocker}`);
  next = setup;
  return `${setup.year.name} from ${setup.year.startDate}, ${setup.peopleCount} people, ${setup.unfinishedGoals} unfinished goals to carry`;
});
await act("Amira launches it", async () => {
  const launched = await amira.post(`/api/performance/cycles/${next.draftId}/launch`, { expectedVersion: next.draftVersion });
  if (!launched.endedCycleId) throw new Error("launched, but the year before didn't end");
  const now = await amira.get(`/api/performance/cycles/${launched.cycleId}/year`);
  return `${launched.people} people, ${launched.carriedGoals} goals carried; ${describe(now)}`;
});
await act("Aicha finds her carried goals in next year's draft", async () => {
  const { plan } = await aicha.get(`/api/performance/cycles/${next.draftId}/plan`).catch(() => ({ plan: null }));
  return plan ? `${plan.state}, ${plan.objectives?.length ?? 0} goals` : "no draft yet (written when she opens it)";
});

console.log("\nThe year walked in one sitting. Rebuild before the demo: node .local-docs/agents/data/demo-preset.mjs reset sitting");
