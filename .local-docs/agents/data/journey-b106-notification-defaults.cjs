// B-106 API journey, through the shell like the browser:
//   node .local-docs/agents/data/journey-b106-notification-defaults.cjs
// Company email modes per notification group in Carthage. Amira (tenant administrator) sees Notifications in both
// modules' settings, makes Performance's 1:1s required and feedback off, and Core HR's team and job changes required.
// Leila then sees 1:1s and team changes locked and feedback off, and can't turn a required group off. Rim (HR partner,
// Performance settings view only) reads but can't save; a stale save
// is refused. Aicha (employee, no settings role) can't read either module's modes; Leila holds the HR partner role
// (B-109), so she reads Performance's.
// Re-runnable: it puts both modules back to the modes it found.
const path = require("path");
const { call, login } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const data = (r) => r.json?.data;
const results = [];
function check(label, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  return ok;
}
const modesOf = (defaults) => Object.fromEntries(defaults.groups.map((group) => [group.key, group.mode]));
const group = (preferences, key) => preferences.groups.find((item) => item.key === key);

(async () => {
  const [amira, rim, leila, aicha] = await Promise.all(
    ["amira.khelifi", "rim.mahjoub", "leila.baccouche", "aicha.bouazizi"].map((who) => login(`${who}@example.test`)));
  const PERF = "/api/performance/settings/notifications";
  const CORE = "/api/corehr/settings/notifications";

  for (const [module, sections] of [["performance", "/api/performance/settings/sections"], ["core", "/api/corehr/settings/sections"]]) {
    const section = (data(await call("GET", sections, null, amira)) ?? []).find((item) => item.id === "notifications");
    check(`Amira manages ${module} Notifications`, section?.access === "manage", section?.access);
  }

  const perfBefore = data(await call("GET", PERF, null, amira));
  const coreBefore = data(await call("GET", CORE, null, amira));
  check("Amira reads both modules' modes", Boolean(perfBefore && coreBefore),
    `${JSON.stringify(modesOf(perfBefore))} ${JSON.stringify(modesOf(coreBefore))}`);

  check("Rim reads Performance's modes", (await call("GET", PERF, null, rim)).status === 200);
  check("Rim can't save them", (await call("PUT", PERF, { expectedVersion: perfBefore.version, modes: {} }, rim)).status === 403);
  check("Aicha can't read Performance's modes", (await call("GET", PERF, null, aicha)).status === 403);
  check("Aicha can't save Performance's modes",
    (await call("PUT", PERF, { expectedVersion: perfBefore.version, modes: { "one-on-ones": "off" } }, aicha)).status === 403);
  check("Aicha can't read Core HR's modes", (await call("GET", CORE, null, aicha)).status === 403);
  check("Aicha can't save Core HR's modes",
    (await call("PUT", CORE, { expectedVersion: coreBefore.version, modes: { "team-and-job-changes": "off" } }, aicha)).status === 403);

  const perfSaved = await call("PUT", PERF, {
    expectedVersion: perfBefore.version,
    modes: { ...modesOf(perfBefore), "one-on-ones": "required", "feedback-and-praise": "off" },
  }, amira);
  check("Amira makes 1:1s required and feedback off", perfSaved.status === 200, JSON.stringify(modesOf(data(perfSaved) ?? { groups: [] })));
  const coreSaved = await call("PUT", CORE, {
    expectedVersion: coreBefore.version, modes: { "team-and-job-changes": "required" },
  }, amira);
  check("Amira makes team and job changes required", coreSaved.status === 200);
  check("A save on the version she started from is refused",
    (await call("PUT", PERF, { expectedVersion: perfBefore.version, modes: { "one-on-ones": "on" } }, amira)).status === 409);
  check("An unknown mode is refused", (await call("PUT", PERF, {
    expectedVersion: data(perfSaved).version, modes: { "one-on-ones": "sometimes" },
  }, amira)).status === 400);

  const leilaPerf = data(await call("GET", "/api/performance/notification-preferences", null, leila));
  const oneOnOnes = group(leilaPerf, "one-on-ones");
  const feedback = group(leilaPerf, "feedback-and-praise");
  check("Leila sees 1:1s locked and emailed", oneOnOnes?.locked === true && oneOnOnes?.email === true);
  check("Leila sees feedback off and switchable", feedback?.locked === false && feedback?.email === false);
  const offRequired = await call("PUT", "/api/performance/notification-preferences", {
    expectedVersion: leilaPerf.version, emailOff: ["one-on-ones"],
  }, leila);
  check("Leila can't turn a required group off", offRequired.status === 400);
  const leilaCore = data(await call("GET", "/api/corehr/notification-preferences", null, leila));
  check("Leila sees team and job changes locked", group(leilaCore, "team-and-job-changes")?.locked === true);

  const section = (data(await call("GET", "/api/performance/settings/sections", null, amira)) ?? []).find((item) => item.id === "notifications");
  check("The section names Amira as its last change", section?.lastChange?.actorName === "Amira Khelifi", section?.lastChange?.actorName);

  // Put both modules back to what they were.
  const perfNow = data(await call("GET", PERF, null, amira));
  const coreNow = data(await call("GET", CORE, null, amira));
  const restored = [
    await call("PUT", PERF, { expectedVersion: perfNow.version, modes: modesOf(perfBefore) }, amira),
    await call("PUT", CORE, { expectedVersion: coreNow.version, modes: modesOf(coreBefore) }, amira),
  ];
  check("Both modules are back to their modes", restored.every((r) => r.status === 200));

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
