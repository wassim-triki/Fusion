// B-184 API journey, through the shell like the browser:
//   node .local-docs/agents/data/journey-b184-joining-leaving.cjs
// In Carthage Digital Group (after seed-b184-joining-leaving.cjs): Amira (HR) hires a journey joiner into Mariam's team
// and the joining checklist is made; HR sees every task, Mariam the manager's and the person's, Leila none; Mariam
// ticks hers (who and when recorded) but not the person's or HR's; HR unticks and ticks; Needs you carries it for
// Mariam and HR; Rim (settings view only) can't change the templates, Leila can't read them; another company can't read
// or tick it. Cancelling the hire removes the checklist, so the journey leaves Carthage as it found it.
const path = require("path");
const { call, login } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const data = (r) => r.json?.data;
const results = [];
function check(label, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  return ok;
}
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

(async () => {
  const amira = await login("amira.khelifi@example.test");
  const mariamToken = await login("mariam.gharbi@example.test");
  const leila = await login("leila.baccouche@example.test");
  const rim = await login("rim.mahjoub@example.test");
  const elsewhere = await login("amira.khelifi@midyear-5.example.test");
  const mariam = data(await call("GET", "/api/corehr/workforce/me", null, mariamToken)).employee;
  const stamp = Date.now().toString(36);

  const templates = await call("GET", "/api/corehr/checklists/templates", null, amira);
  check("HR reads the company's checklists", templates.status === 200 && data(templates).joining.length > 0, `${data(templates)?.joining.length} joining tasks`);
  check("An employee can't read them", (await call("GET", "/api/corehr/checklists/templates", null, leila)).status === 403);
  check("Settings view only can't change them", (await call("PUT", "/api/corehr/checklists/templates/joining", { tasks: [] }, rim)).status === 403);
  check("A task needs an owner", (await call("PUT", "/api/corehr/checklists/templates/joining",
    { tasks: [{ title: "Nobody's", owner: "someone", offsetDays: 0 }] }, amira)).status === 400);

  const jobs = data(await call("GET", "/api/corehr/catalog/jobs", null, amira));
  const job = jobs.find((item) => !item.isRetired && item.peopleCount > 0);
  const hire = await call("POST", "/api/corehr/employees/hire", {
    firstName: "Journey", lastName: `Joiner ${stamp}`, employeeNumberMode: "Generated", startDate: `${day(5)}T00:00:00Z`,
    orgUnitId: mariam.orgUnit.orgUnitId, jobId: job.id, primaryManagerEmployeeId: mariam.employeeId }, amira);
  const key = data(hire)?.employeeKey;
  check("HR hires someone into Mariam's team", hire.status === 201, `${hire.status}`);

  const lists = (token) => call("GET", `/api/corehr/people/${key}/checklists`, null, token);
  const hr = data(await lists(amira))?.[0];
  const owners = (list) => [...new Set((list?.tasks ?? []).map((task) => task.owner))].sort().join(",");
  check("The hire made the joining checklist, dated from the first day", hr?.kind === "Joining" && hr.day === day(5)
    && hr.tasks.length === data(templates).joining.length, `${hr?.tasks.length} tasks`);
  const manager = data(await lists(mariamToken))?.[0];
  check("HR sees every task", owners(hr) === "hr,manager,person");
  check("The manager sees the manager's and the person's", owners(manager) === "manager,person");
  check("Someone else sees none", (data(await lists(leila)) ?? []).length === 0);

  const task = (owner) => hr.tasks.find((item) => item.owner === owner);
  const tick = (id, done, token) => call("PUT", `/api/corehr/checklists/tasks/${id}`, { done }, token);
  const ticked = await tick(task("manager").id, true, mariamToken);
  check("Mariam ticks her task; who and when are recorded", ticked.status === 200 && data(ticked).doneBy === "Mariam Gharbi" && Boolean(data(ticked).doneAt));
  check("…but not the person's", (await tick(task("person").id, true, mariamToken)).status === 403);
  check("…and HR's reads as not found", (await tick(task("hr").id, true, mariamToken)).status === 404);
  check("Someone else can't tick any", (await tick(task("manager").id, false, leila)).status === 404);
  const undone = await tick(task("manager").id, false, amira);
  check("HR unticks it", undone.status === 200 && data(undone).doneAt === null && data(undone).doneBy === null);
  check("HR ticks its own", (await tick(task("hr").id, true, amira)).status === 200);

  const work = async (token) => (data(await call("GET", "/api/corehr/work", null, token)) ?? []).filter((item) => item.kind === "checklist");
  const mariamWork = (await work(mariamToken)).find((item) => item.subject?.displayName === `Journey Joiner ${stamp}`);
  check("Needs you carries it for the manager, with her tasks", Boolean(mariamWork) && mariamWork.steps.length === manager.tasks.filter((t) => t.owner === "manager").length,
    mariamWork?.title);
  check("…and for HR", (await work(amira)).some((item) => item.subject?.displayName === `Journey Joiner ${stamp}`));
  check("…not for someone else", !(await work(leila)).some((item) => item.subject?.displayName === `Journey Joiner ${stamp}`));

  check("Another company can't read the checklist", (await lists(elsewhere)).status === 404);
  check("…or tick it", (await tick(task("hr").id, false, elsewhere)).status === 404);

  const birthday = await call("PUT", "/api/corehr/me/birthday", { share: false }, leila);
  check("A person chooses whether their birthday shows", birthday.status === 200 && data(birthday).share === false);

  const upcoming = data(await call("GET", "/api/corehr/employees/people/changes/upcoming", null, amira)) ?? [];
  const change = upcoming.find((item) => item.person.employeeKey === key);
  const cancelled = await call("POST", `/api/corehr/employees/people/changes/${change?.id}/cancel`, {}, amira);
  check("Clean-up: cancelling the hire removes the checklist", cancelled.status === 204
    && (await lists(amira)).status === 404, `${cancelled.status}`);

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
