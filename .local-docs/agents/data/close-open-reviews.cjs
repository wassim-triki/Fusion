// B-331: closes every review in a round that is still open (no manager review in yet) "without result", as the
// administrator, through the product API, so a walkthrough with one finished review can calibrate and release.
// Review ids are read with read-only SQL (no API lists them); each close reads the review for its version first.
// Run: node .local-docs/agents/data/close-open-reviews.cjs <administrator email> <round id> [reason]
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { call, login } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const [email, roundId, reason = "Not reviewed this round"] = process.argv.slice(2);
if (!email || !/^[0-9a-f-]{36}$/.test(roundId ?? "")) throw new Error("Usage: close-open-reviews.cjs <admin email> <round id> [reason]");

const sql = path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/sql.ps1");
const ids = execFileSync("pwsh", ["-NoProfile", "-File", sql, "-Database", "performance",
  `select "Id" from performance."PerformanceReviews" where "ReviewRoundId"='${roundId}'`], { encoding: "utf8" })
  .split(/\r?\n/).map((line) => line.trim()).filter((line) => /^[0-9a-f-]{36}$/.test(line));

(async () => {
  const token = await login(email);
  let closed = 0, kept = 0, failed = 0;
  for (const id of ids) {
    const review = (await call("GET", `/api/performance/reviews/${id}`, null, token)).json?.data;
    if (!review) { failed++; continue; }
    const state = String(review.state ?? review.status ?? "");
    if (!/SelfAssessment|ManagerAssessment|NotStarted|Open/i.test(state)) { kept++; continue; }
    const r = await call("POST", `/api/performance/reviews/${id}/close`, { expectedVersion: review.version, reason }, token);
    if (r.status === 200) closed++; else { failed++; console.log(`  ${review.subjectDisplayName ?? id}: ${r.status} ${JSON.stringify(r.json?.errors ?? r.json).slice(0, 200)}`); }
  }
  console.log(`${ids.length} reviews: ${closed} closed without result, ${kept} kept (already past the manager review), ${failed} failed`);
})().catch((e) => { console.error(e.message); process.exit(1); });
