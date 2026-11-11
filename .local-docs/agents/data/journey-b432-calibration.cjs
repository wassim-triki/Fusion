#!/usr/bin/env node
/**
 * B-432 (slice 9, calibration and release): who may calibrate and who may release, through the shell, with the
 * negatives. On the `yearend` preset, Amira Khelifi (administrator) reads the round's calibration (flagged reviews only,
 * each with why), keeps one flagged review and undoes it, and sees the Year page's release with its rows; Mariam Gharbi
 * (manager) and Aicha Bouazizi (employee) get nothing of calibration and can't release; the `planning` preset's
 * administrator finds no such round. Changes nothing it doesn't put back: no result is released.
 * Usage: node .local-docs/agents/data/journey-b432-calibration.cjs
 */
const { call, login } = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");
const presets = require("./demo-presets.local.json");

const preset = (name) => presets.presets?.[name] ?? presets[name];
const email = (name, who) => Object.values(preset(name).employees).find((e) => e.name === who).email;
let failed = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`); if (!ok) failed++; };

(async () => {
  const amira = await login(email("yearend", "Amira Khelifi"));
  const mariam = await login(email("yearend", "Mariam Gharbi"));
  const aicha = await login(email("yearend", "Aicha Bouazizi"));
  const elsewhere = await login(email("planning", "Amira Khelifi"));

  const context = (await call("GET", "/api/performance/context", null, amira)).json.data;
  const year = (await call("GET", `/api/performance/cycles/${context.selected.id}/year`, null, amira)).json.data;
  const roundId = year.review?.roundId;
  check("the year has a running round", Boolean(roundId), year.phase);
  const path = `/api/performance/review-rounds/${roundId}/calibration`;

  const read = await call("GET", path, null, amira);
  const cal = read.json?.data;
  check("Amira reads the round's calibration", read.status === 200,
    cal ? `${cal.writing.count} being written, ${cal.ready.count} ready, ${cal.toLookAt.count} to look at` : `${read.status}`);
  check("only flagged reviews are cards, each with why", cal.flagged.every((c) => ["goals", "moved", "ratesHigh", "ratesLow"].includes(c.flag.kind)),
    cal.flagged.map((c) => `${c.name}: ${c.flag.kind}`).join("; "));
  check("Amira may release", cal.canRelease === true);
  check("the Year page's release has its rows", year.nextMove?.kind === "release" && Boolean(year.nextMove.release),
    year.nextMove?.release ? `${year.nextMove.release.asRated} as rated, ${year.nextMove.release.stillWriting} still being written` : "");
  const everyone = await call("GET", `${path}/everyone`, null, amira);
  check("the full view reads", everyone.status === 200, `${everyone.json?.data.people.length} people`);

  const open = cal.flagged.find((c) => !c.decision);
  if (open) {
    const changeWithout = await call("PUT", `${path}/subjects/${open.reviewId}/decision`,
      { rating: open.rating === cal.scale[0].value ? cal.scale[1].value : cal.scale[0].value, reason: null, expectedVersion: open.version }, amira);
    check("changing a rating without a reason is refused", changeWithout.status === 400, `${changeWithout.status}`);
    const kept = await call("PUT", `${path}/subjects/${open.reviewId}/decision`, { rating: open.rating, reason: null, expectedVersion: open.version }, amira);
    check("keeping takes one call with no reason", kept.status === 200 && kept.json.data.decision?.kept === true);
    const stale = await call("PUT", `${path}/subjects/${open.reviewId}/decision`, { rating: open.rating, reason: null, expectedVersion: open.version }, amira);
    check("a decision on a stale version is refused", stale.status === 409, `${stale.status}`);
    const undone = await call("DELETE", `${path}/subjects/${open.reviewId}/decision?expectedVersion=${kept.json.data.version}`, null, amira);
    check("undo puts it back to look at", undone.status === 200 && undone.json.data.decision === null);
  } else check("a flagged review is waiting", false, "none on this preset");

  const roundVersion = year.nextMove?.release?.roundVersion ?? 0;
  for (const [who, token] of [["Mariam (manager)", mariam], ["Aicha (employee)", aicha]]) {
    check(`${who} can't read calibration`, (await call("GET", path, null, token)).status === 403);
    check(`${who} can't decide`, (await call("PUT", `${path}/subjects/${open?.reviewId ?? roundId}/decision`, { rating: 3, reason: "x", expectedVersion: 0 }, token)).status === 403);
    check(`${who} can't release`, (await call("POST", `/api/performance/review-rounds/${roundId}/finalize`, { expectedVersion: roundVersion, reviewIds: [] }, token)).status === 403);
  }
  check("another tenant's administrator finds no such round", (await call("GET", path, null, elsewhere)).status === 404);
  check("nor its full view", (await call("GET", `${path}/everyone`, null, elsewhere)).status === 404);

  console.log(failed ? `${failed} failed` : "all passed");
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
