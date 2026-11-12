// The demo preset journey (B-095, demo-seed-verification "Preset journey verification"): read-only checks, through
// :3000/api as the preset's personas, that a preset reached its intended state; plus the demo clock's refusals.
//   node .local-docs/agents/data/journey-demo-preset.cjs <fresh|planning|midyear|yearend|nextcycle>
// Reads demo-presets.local.json. Exits non-zero on any failed check.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { BASE, call, login } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const key = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "demo-presets.local.json"), "utf8"));
const preset = manifest.presets[key];
if (!preset) { console.error(`No built preset "${key}" in the manifest; build it first.`); process.exit(2); }

let passed = 0, failed = 0;
const check = (label, ok, detail = "") => {
  ok ? passed++ : failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
};
const hash = (...parts) => crypto.createHash("md5").update(parts.join(":")).digest().readUInt32BE(0);
const email = (name) => preset.personas.find((p) => p.name.startsWith(name)).email;
const tokens = {};
const as = async (name) => (tokens[name] ??= await login(email(name)));
const get = async (name, route) => {
  const r = await call("GET", route, null, await as(name));
  if (r.status >= 400) throw new Error(`GET ${route} as ${name}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json?.data ?? r.json;
};
const runDay = new Date(`${preset.runDate}T00:00:00Z`);
const daysAgo = (n) => new Date(runDay.getTime() - n * 86_400_000);
const cycle = (k) => preset.cycles[k];
const base = (k) => `/api/performance/cycles/${cycle(k).id}`;

async function lastYear() {
  const last = await get("Amira", base("last"));
  check("Last year's cycle is closed", last.cycle.state === "Closed", last.cycle.state);
  const own = (await get("Aicha", `/api/performance/reviews/workspace?cycle=${cycle("last").id}`)).own;
  const review = own && await get("Aicha", `/api/performance/reviews/${own.reviewId}`);
  check("Aicha sees last year's released result (Strong) and when she acknowledged it",
    review?.finalRating === 4 && Boolean(review?.acknowledgement?.at), `${review?.finalRating} ${review?.acknowledgement?.at ?? "not acknowledged"}`);
}

async function bell() {
  const page = await get("Mariam", "/api/performance/notifications");
  const cutoff = daysAgo(7).toISOString();
  const staleUnread = page.items.filter((n) => !n.readAt && n.occurredAt < cutoff);
  check("Mariam's bell has only last week's notifications unread", staleUnread.length === 0, `${page.unreadCount} unread, ${staleUnread.length} older`);
}

async function myPlan(name, k = "current") {
  return (await get(name, `${base(k)}/plan`))?.plan ?? null;
}

const CHECKS = {
  async fresh() {
    const context = await get("Amira", "/api/performance/context");
    check("No cycle exists yet", context.cycles.length === 0, `${context.cycles.length}`);
    const overview = await get("Amira", "/api/performance/overview");
    check("Amira's Overview offers to set up the first cycle", overview.rows.some((r) => r.kind === "noCycle" && r.canCreate), overview.rows.map((r) => r.kind).join(","));
  },

  async planning() {
    await lastYear();
    const current = await get("Amira", base("current"));
    check("This year is Active in Planning", current.cycle.state === "Active" && current.phase === "Planning", `${current.cycle.state} ${current.phase}`);
    const states = Object.fromEntries(await Promise.all(["Aicha", "Leila", "Khaled", "Rim"].map(async (n) => [n, await myPlan(n)])));
    check("Aicha's plan is submitted", states.Aicha?.state === "Submitted", states.Aicha?.state);
    check("Leila's plan is in Draft", states.Leila?.state === "Draft", states.Leila?.state);
    check("Khaled's plan was returned with a change request", states.Khaled?.state === "Draft" && (states.Khaled?.readiness?.openChangeRequests ?? 0) > 0,
      `${states.Khaled?.state}, ${states.Khaled?.readiness?.openChangeRequests} open`);
    check("Rim's plan is approved", states.Rim?.state === "Approved", states.Rim?.state);
    const notStarted = Object.values(preset.employees).find((p) => {
      const index = Number(Object.keys(preset.employees).find((k) => preset.employees[k] === p).slice(4));
      return index > 27 && hash("late", index) % 10 === 0;
    });
    const token = await login(notStarted.email);
    const none = (await call("GET", `${base("current")}/plan`, null, token)).json?.data;
    check(`${notStarted.name} hasn't started a plan`, !none?.hasPlan, `${none?.hasPlan}`);
    const work = await get("Mariam", "/api/performance/work");
    check("Mariam has Aicha's plan to approve", work.some((w) => /plan/i.test(w.kind) && w.title.includes("Aicha")), work.map((w) => w.kind).join(", "));
    await bell();
  },

  async midyear() {
    await lastYear();
    const current = await get("Amira", base("current"));
    check("This year is Active in Execution", current.cycle.state === "Active" && current.phase === "Execution", `${current.cycle.state} ${current.phase}`);
    const plan = await myPlan("Aicha");
    check("Aicha's plan is approved", plan?.state === "Approved", plan?.state);
    const history = await get("Aicha", `${base("current")}/objectives/${plan.objectives[0].id}/progress/history`);
    const entries = history.items ?? history.entries ?? history;
    check("Aicha's first objective has monthly check-ins since planning closed", entries.length >= 4, `${entries.length}`);
    const progress = await get("Aicha", `${base("current")}/objectives/${plan.objectives[0].id}/progress`);
    check("Aicha's first objective is at risk", progress.status === "AtRisk" || progress.currentStatus === "AtRisk", progress.status ?? progress.currentStatus);
    const requests = await get("Mariam", `${base("current")}/plans/${plan.id}/update-requests`);
    check("Mariam's update request to Aicha is open", (requests.items ?? requests).some((r) => r.state === "Open"), (requests.items ?? requests).map((r) => r.state).join(","));
    const series = await get("Mariam", "/api/performance/one-on-ones");
    const running = series.reports.filter((r) => !r.ended).length + (series.withManager && !series.withManager.ended ? 1 : 0);
    check("Mariam has 1:1 series running", running >= 2, `${running}`);
    await bell();
  },

  async yearend() {
    await lastYear();
    const round = await get("Amira", `/api/performance/review-rounds/${cycle("current").roundId}`);
    const self = round.progress.stages.find((s) => /self/i.test(s.stage));
    const share = self.done / self.total;
    check("About 81% of self-assessments are in", share > 0.72 && share < 0.9, `${self.done}/${self.total}`);
    const manager = round.progress.stages.find((s) => /manager/i.test(s.stage));
    check("Managers wrote every review whose self-assessment is in", manager.done === self.done, `${manager.done} manager, ${self.done} self`);
    const own = (await get("Aicha", `/api/performance/reviews/workspace?cycle=${cycle("current").id}`)).own;
    const forMariam = await get("Mariam", `/api/performance/reviews/${own.reviewId}`);
    check("Aicha's self-assessment isn't in", !forMariam.selfAssessment?.submittedAt);
    const answered = (forMariam.peers?.people ?? []).filter((p) => p.state === "Answered").length;
    check("Three peers answered about Aicha", answered === 3, `${answered}`);
    const ratings = async (name) => {
      const rows = (await get(name, `/api/performance/reviews/workspace?cycle=${cycle("current").id}`)).toWrite ?? [];
      const values = [];
      for (const row of rows) {
        const review = await get(name, `/api/performance/reviews/${row.reviewId}`);
        if (review.managerAssessment?.submittedAt) values.push(review.managerAssessment.overallRating);
      }
      return values;
    };
    const avg = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    const [omar, mariam] = [await ratings("Omar"), await ratings("Mariam")];
    check("Omar rates above Mariam", avg(omar) > avg(mariam) + 0.4, `Omar ${avg(omar).toFixed(2)}, Mariam ${avg(mariam).toFixed(2)}`);
    check("One of Mariam's ratings is a 5", mariam.includes(5), mariam.join(","));
    const next = await get("Amira", base("next"));
    check("Next year's cycle waits in Draft", next.cycle.state === "Draft", next.cycle.state);
    await bell();
  },

  async nextcycle() {
    await lastYear();
    const current = await get("Amira", base("current"));
    // Nobody closes a year (D-57): it ended on its date with results out, and ends for good when the next one launches.
    check("This year has ended with its results out", current.cycle.state === "Active" && current.phase === "ResultsOut", `${current.cycle.state} ${current.phase}`);
    const own = (await get("Aicha", `/api/performance/reviews/workspace?cycle=${cycle("current").id}`)).own;
    const review = await get("Aicha", `/api/performance/reviews/${own.reviewId}`);
    check("Aicha sees this year's released result", review.finalRating != null && Boolean(review.finalizedAt), `${review.finalRating}`);
    const setup = await get("Amira", "/api/performance/cycles/setup");
    check("Next year is set up and can launch now", setup.draftId === cycle("next").id && setup.launchBlocker === null,
      `${setup.year.name} blocker=${setup.launchBlocker}`);
    await bell();
  },
};

(async () => {
  for (const persona of preset.personas) {
    const ok = await login(persona.email).then(() => true, () => false);
    check(`${persona.name} signs in`, ok, persona.email);
  }
  await CHECKS[key]();
  // The demo clock's guards: refused, never written.
  const token = await as("Amira");
  for (const [label, value] of [["a future instant", new Date(Date.now() + 86_400_000).toISOString()], ["a malformed value", "last-year"]]) {
    const r = await fetch(`${BASE}/api/performance/work`, { headers: { Authorization: `Bearer ${token}`, "X-Demo-Clock": value } });
    const code = (await r.json().catch(() => null))?.details?.code;
    check(`The demo clock refuses ${label}`, r.status === 400 && code === "demo_clock_invalid", `${r.status} ${code}`);
  }
  console.log(`\n${key}: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
