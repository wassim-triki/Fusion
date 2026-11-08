// Slice 3 API journey (add-one-on-ones-feedback-and-praise, task 10.2), through the shell like the browser. Run after
// seed-conversations.cjs: steps 1–7 and 9 verify what the seed built (read-only); step 8 gives one praise and deletes
// it again; step 10 starts 1:1s between Mariam Gharbi and Salah Ben Hassine (CDG-084, not a demo persona), moves
// Salah to Omar Mansour in Core HR, and checks the series ends on the next write. Salah stays under Omar afterwards.
//   node .local-docs/agents/data/journey-conversations.cjs
const path = require("path");
const crypto = require("crypto");
const { call, login } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));
const { employee: employeeId } = require("./carthage-ids.cjs");

const data = (r) => r.json?.data;
const results = [];
function check(label, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  return ok;
}
const today = () => new Date().toISOString().slice(0, 10);

(async () => {
  const tokens = {};
  const as = async (who) => (tokens[who] ??= await login(`${who}@example.test`));
  const ids = {};
  const me = async (who) => {
    if (!ids[who]) {
      const self = data(await call("GET", "/api/corehr/workforce/me", null, await as(who))).employee;
      ids[who] = self.employeeId ?? self.id;
    }
    return ids[who];
  };
  const [mariam, aicha, amira, khaled, leila, omar] =
    await Promise.all(["mariam.gharbi", "aicha.bouazizi", "amira.khelifi", "khaled.sassi", "leila.baccouche", "omar.mansour"].map(as));
  const aichaId = await me("aicha.bouazizi");

  // 1. The Mariam ↔ Aicha series exists and Aicha was told when Mariam started it.
  const mariamList = data(await call("GET", "/api/performance/one-on-ones", null, mariam));
  const row = mariamList?.reports?.find((r) => r.with.employeeId === aichaId);
  check("1. Mariam's 1:1s list Aicha with a next meeting", Boolean(row?.nextMeetingAt));
  const bell = data(await call("GET", "/api/performance/notifications", null, aicha));
  const bellItems = bell?.items ?? bell ?? [];
  check("1. Aicha was notified that 1:1s started", bellItems.some((n) => n.kind === "OneOnOneStarted"));
  const seriesPath = `/api/performance/one-on-ones/${row?.seriesId}`;
  const asMariam = data(await call("GET", seriesPath, null, mariam));
  const asAicha = data(await call("GET", seriesPath, null, aicha));
  const held = asMariam?.past?.[0];

  // 2. Both added to the agenda, Mariam from a suggestion.
  check("2. The held meeting has items from both people", new Set(held?.agenda?.map((i) => i.authorEmployeeId)).size === 2);
  check("2. One item came from a suggestion and links to its source", held?.agenda?.some((i) => i.sourceKind && i.href));

  // 3. Private notes stay with their authors.
  const mariamRaw = JSON.stringify(asMariam);
  const aichaRaw = JSON.stringify(asAicha);
  check("3. Mariam's private note never reaches Aicha", mariamRaw.includes("Check in on workload") && !aichaRaw.includes("Check in on workload"));
  check("3. Aicha's private note never reaches Mariam", aichaRaw.includes("training budget") && !mariamRaw.includes("Ask about the test automation"));

  // 4. Completion rolled the series forward and the open action carried.
  const gapDays = held && asMariam.upcoming
    ? Math.round((Date.parse(asMariam.upcoming.scheduledAt) - Date.parse(held.scheduledAt)) / 86_400_000) : null;
  check("4. The next meeting is two weeks after the held one", gapDays === 14, `${gapDays} days`);
  check("4. An open action carried over", asMariam?.upcoming?.actions?.some((a) => a.carriedOver && !a.done));

  // 5. HR doesn't see someone else's 1:1.
  check("5. Amira (HR) gets not found on Mariam ↔ Aicha", (await call("GET", seriesPath, null, amira)).status === 404);

  // 6. Manager-only feedback reaches Mariam only.
  const team = data(await call("GET", "/api/performance/feedback?view=team", null, mariam))?.items ?? [];
  const managerOnly = team.find((f) => f.visibility === "ManagerOnly" && f.receiver.id === aichaId);
  check("6. Mariam reads Khaled's manager-only feedback about Aicha", Boolean(managerOnly));
  if (managerOnly) {
    check("6. Aicha can't read it", (await call("GET", `/api/performance/feedback/${managerOnly.id}`, null, aicha)).status === 404);
    check("6. Amira (HR) can't read it", (await call("GET", `/api/performance/feedback/${managerOnly.id}`, null, amira)).status === 404);
  }

  // 7. The request: one answer, one decline, the requester told, the invitee sees only their part.
  const leilaRequests = data(await call("GET", "/api/performance/feedback/requests", null, leila));
  const request = leilaRequests?.mine?.find((r) => r.question.startsWith("How did the Product B onboarding"));
  check("7. Leila's request shows one answer and one decline", request?.answered === 1 && request?.declined === 1);
  const asInvitee = await call("GET", `/api/performance/feedback/requests/${request?.id}`, null, aicha);
  const inviteeRaw = JSON.stringify(asInvitee.json);
  check("7. Aicha's view hides the other invitees and answers",
    asInvitee.status === 200 && data(asInvitee).invitees === null && !inviteeRaw.includes("pairing hour") && !inviteeRaw.includes("Khaled"));
  const leilaBell = data(await call("GET", "/api/performance/notifications", null, leila));
  check("7. Leila was notified of both responses",
    (leilaBell?.items ?? leilaBell ?? []).filter((n) => n.kind === "FeedbackRequestResponded").length >= 2);

  // 8. Praise for two people, their managers told, deleted by HR.
  const values = data(await call("GET", "/api/performance/values", null, leila));
  const praiseId = crypto.randomUUID();
  const given = await call("POST", "/api/performance/praise", {
    id: praiseId, recipientEmployeeIds: [aichaId, await me("rim.mahjoub")], competencyId: values[0].id,
    message: "Thank you both for the weekend data migration.",
  }, leila);
  check("8. Leila praises Aicha and Rim", given.status === 200);
  const mariamBell = data(await call("GET", "/api/performance/notifications", null, mariam));
  check("8. Mariam (Aicha's manager) was notified",
    (mariamBell?.items ?? mariamBell ?? []).some((n) => n.kind === "PraiseForReport" && n.href.includes(praiseId)));
  check("8. Amira (HR) deletes it", (await call("DELETE", `/api/performance/praise/${praiseId}`, null, amira)).status === 200);
  const feed = data(await call("GET", "/api/performance/praise?limit=20", null, khaled))?.items ?? [];
  const summary = data(await call("GET", `/api/performance/people/${aichaId}/summary`, null, khaled));
  check("8. It's gone from the feed and Aicha's summary",
    !feed.some((p) => p.id === praiseId) && !summary?.praise?.items?.some((p) => p.id === praiseId));

  // 9. Work: Aicha has the open request and the action due soon.
  const work = data(await call("GET", "/api/performance/work", null, aicha)) ?? [];
  check("9. Aicha's work has the feedback request", work.some((w) => w.kind === "feedback-request"));
  check("9. Aicha's work has the 1:1 action due soon", work.some((w) => w.kind === "one-on-one-action"));

  // 10. A Core HR manager change ends a series on its next write.
  const salahId = employeeId("CDG-084");
  const salahKey = data(await call("GET", `/api/performance/people/${salahId}/summary`, null, amira))?.stableEmployeeKey;
  const startedSalah = await call("POST", "/api/performance/one-on-ones",
    { withEmployeeId: salahId, cadence: "Weekly", firstMeetingAt: new Date(Date.now() + 3 * 3_600_000).toISOString() }, mariam);
  const salahSeries = data(startedSalah) ?? (startedSalah.json?.details?.extra?.seriesId
    ? data(await call("GET", `/api/performance/one-on-ones/${startedSalah.json.details.extra.seriesId}`, null, mariam)) : null);
  check("10. Mariam starts 1:1s with Salah", Boolean(salahSeries), `${startedSalah.status}`);
  const moved = await call("POST", `/api/corehr/employees/people/${salahKey}/changes/job`,
    { effectiveDate: today(), managerEmployeeId: await me("omar.mansour") }, amira);
  check("10. Core HR moves Salah to Omar", moved.status < 300, `${moved.status} ${moved.json?.errors?.[0] ?? ""}`);
  const write = await call("PUT", `/api/performance/one-on-ones/${salahSeries?.id}/cadence`,
    { cadence: "Monthly", expectedVersion: salahSeries?.version ?? 0 }, mariam);
  check("10. Mariam's next write is refused because the series ended",
    write.status === 409 && write.json?.details?.code === "OneOnOne.SeriesEnded", `${write.status} ${write.json?.details?.code ?? ""}`);
  const ended = data(await call("GET", `/api/performance/one-on-ones/${salahSeries?.id}`, null, mariam));
  check("10. The series reads as ended with the reporting line", ended?.ended === true && ended?.endReason === "ReportingLineEnded");
  check("10. Omar now sees Salah as someone to start 1:1s with",
    (data(await call("GET", "/api/performance/one-on-ones", null, omar))?.startWithReports ?? []).some((o) => o.with.employeeId === salahId));

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed.`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
