// B-175 API journey, through the shell like the browser:
//   node .local-docs/agents/data/journey-b175-catalog.cjs
// In Carthage Digital Group, Amira (tenant administrator) works the company's jobs, places and lists: adds a job,
// refuses a duplicate, renames it, gives Leila the job from a date ahead (the change carries the new title), merges a
// stray job into it, retires and brings back a list value. Aicha (employee) can't read or change the catalogue; Mariam
// (manager) can't change it; another company's job is not found. A scheduled hire takes a job and a place by id.
// Re-runnable: it cancels the changes it schedules and deletes or merges away what it adds.
const path = require("path");
const { BASE, call, login } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const data = (r) => r.json?.data;
const results = [];
function check(label, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  return ok;
}
const stamp = Date.now().toString(36).slice(-5);

(async () => {
  const [amira, leila, aicha, mariam, other] = await Promise.all([
    login("amira.khelifi@example.test"),
    login("leila.baccouche@example.test"),
    login("aicha.bouazizi@example.test"),
    login("mariam.gharbi@example.test"),
    login("amira.khelifi@yearend-2.example.test"),
  ]);
  const C = "/api/corehr/catalog";

  check("1. The catalogue refuses an anonymous caller", (await fetch(`${BASE}${C}/jobs`)).status === 401);

  const jobs = await call("GET", `${C}/jobs`, null, amira);
  const grouped = data(jobs) ?? [];
  check("2. Amira reads the jobs; every job someone holds has a family and a level", jobs.status === 200 && grouped.length > 0
    && grouped.filter((job) => job.peopleCount > 0).every((job) => job.family && job.level), `${grouped.length} jobs`);
  const places = data(await call("GET", `${C}/places`, null, amira)) ?? [];
  check("3. Amira reads the places, with who works there", places.length > 0 && places.some((place) => place.peopleCount > 0), `${places.length} places`);
  const lists = data(await call("GET", `${C}/lists`, null, amira)) ?? [];
  check("4. The company's five lists come with their defaults",
    lists.length === 5 && lists.find((list) => list.id === "employment-types")?.values.some((value) => value.key === "full-time"));

  const title = `Journey Analyst ${stamp}`;
  const created = await call("POST", `${C}/jobs`, { title }, amira);
  const job = data(created);
  check("5. Amira adds a job", created.status === 200 && job?.title === title && !job.inUse);
  check("6. The same title in other casing is refused", (await call("POST", `${C}/jobs`, { title: title.toUpperCase() }, amira)).status === 409);

  check("7. Aicha (employee) can't read the catalogue", (await call("GET", `${C}/jobs`, null, aicha)).status === 403);
  check("8. Aicha can't add a job", (await call("POST", `${C}/jobs`, { title: `Aicha ${stamp}` }, aicha)).status === 403);
  check("9. Mariam (manager) can't add a job", (await call("POST", `${C}/jobs`, { title: `Mariam ${stamp}` }, mariam)).status === 403);
  check("10. Mariam can't add a list value", (await call("POST", `${C}/lists/levels/values`, { label: `Mariam ${stamp}` }, mariam)).status === 403);
  check("11. Another company can't rename Amira's job", (await call("PUT", `${C}/jobs/${job.id}`, { title: "Taken" }, other)).status === 404);

  const me = async (token) => data(await call("GET", "/api/corehr/workforce/me", null, token)).employee;
  const leilaMe = await me(leila);
  const date = new Date(Date.now() + 25 * 86400000).toISOString().slice(0, 10);
  const foreign = data(await call("GET", `${C}/jobs`, null, other))[0];
  const refused = await call("POST", `/api/corehr/employees/people/${leilaMe.stableEmployeeKey}/changes/job`,
    { effectiveDate: `${date}T00:00:00Z`, jobId: foreign.id }, amira);
  check("12. A job change refuses another company's job as not found", refused.status === 404, `${refused.status}`);
  const change = await call("POST", `/api/corehr/employees/people/${leilaMe.stableEmployeeKey}/changes/job`,
    { effectiveDate: `${date}T00:00:00Z`, jobId: job.id }, amira);
  const changed = data(change);
  check("13. Amira gives Leila the job from a date ahead", change.status === 200 && changed?.details?.titleTo === title
    && changed.details.jobToId === job.id, `${change.status}`);

  const renamed = `Journey Lead Analyst ${stamp}`;
  const rename = await call("PUT", `${C}/jobs/${job.id}`, { title: renamed }, amira);
  check("14. Renaming the job keeps it in use", rename.status === 200 && data(rename).inUse);
  const profile = data(await call("GET", `/api/corehr/employees/people/${leilaMe.stableEmployeeKey}?asOf=${date}`, null, amira));
  check("15. Leila's job on the date reads the new name", profile?.work?.jobTitle === renamed && profile.work.jobId === job.id,
    profile?.work?.jobTitle);
  check("16. A job in use can't be deleted", (await call("DELETE", `${C}/jobs/${job.id}`, null, amira)).status === 409);

  const stray = data(await call("POST", `${C}/jobs`, { title: `Jorney Analist ${stamp}` }, amira));
  const merged = await call("POST", `${C}/jobs/${stray.id}/merge`, { intoId: job.id }, amira);
  check("17. A stray duplicate merges into the job and goes", merged.status === 200
    && !(data(await call("GET", `${C}/jobs`, null, amira)) ?? []).some((item) => item.id === stray.id));

  const place = places.find((item) => item.peopleCount > 0);
  const hireDate = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
  const unit = profile.work.orgUnitId;
  const hire = await call("POST", "/api/corehr/employees/hire", {
    firstName: "Journey", lastName: `Hire ${stamp}`, employeeNumberMode: "Generated", startDate: `${hireDate}T00:00:00Z`,
    orgUnitId: unit, jobId: job.id, placeId: place.id }, amira);
  const hired = data(hire);
  check("18. A scheduled hire takes a job and a place by id", hire.status === 201 && hired?.jobTitle === renamed && hired.location === place.name,
    `${hire.status}`);

  const upcoming = data(await call("GET", "/api/corehr/employees/people/changes/upcoming", null, amira)) ?? [];
  const mine = upcoming.filter((item) => item.person.employeeKey === leilaMe.stableEmployeeKey && item.details.jobToId === job.id
    || item.person.employeeKey === hired?.employeeKey);
  for (const item of mine) await call("POST", `/api/corehr/employees/people/changes/${item.id}/cancel`, {}, amira);
  const deleted = await call("DELETE", `${C}/jobs/${job.id}`, null, amira);
  check("19. Once the changes are cancelled the job is unused and deletes", mine.length === 2 && deleted.status === 204,
    `${mine.length} cancelled, ${deleted.status}`);

  const added = await call("POST", `${C}/lists/change-reasons/values`, { label: `Journey reason ${stamp}` }, amira);
  const value = data(added);
  const retired = await call("POST", `${C}/lists/change-reasons/values/${value.id}/retire`, {}, amira);
  const restored = await call("POST", `${C}/lists/change-reasons/values/${value.id}/restore`, {}, amira);
  check("20. A list value is added, retired and brought back", added.status === 200 && data(retired).isRetired && !data(restored).isRetired);
  check("21. An unknown list is not found", (await call("POST", `${C}/lists/colours/values`, { label: "Red" }, amira)).status === 404);
  check("22. An unused value deletes", (await call("DELETE", `${C}/lists/change-reasons/values/${value.id}`, null, amira)).status === 204);

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
