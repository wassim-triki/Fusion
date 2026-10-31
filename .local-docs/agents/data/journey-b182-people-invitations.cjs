// B-182 API journey, through the shell like the browser:
//   node .local-docs/agents/data/journey-b182-people-invitations.cjs
// In Carthage Digital Group: Amira (HR, access) lists People's views with sign-in and exports them; Aicha (employee)
// browses the directory but can't list, export or invite; Amira plans invitations for later, another company's
// administrator can't cancel them, Amira cancels them; Amira invites one person now (Mailpit gets the email) and the
// row says Invited, then withdraws it. Leaves no plan; the withdrawal doesn't take yet (B-235), so one invitation stays out.
const path = require("path");
const { call, login } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const BASE = "http://localhost:3000";
const MAILPIT = "http://localhost:8025";
const data = (r) => r.json?.data;
const results = [];
function check(label, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  return ok;
}

(async () => {
  const amira = await login("amira.khelifi@example.test");
  const aicha = await login("aicha.bouazizi@example.test");
  const elsewhere = await login("amira.khelifi@midyear-5.example.test");
  const people = "/api/corehr/employees/people";

  const everyone = await call("GET", `${people}?view=Everyone&pageSize=5`, null, amira);
  const views = data(everyone)?.views;
  check("HR lists People with every view counted", everyone.status === 200 && views?.everyone > 0 && typeof views?.notSignedIn === "number",
    JSON.stringify(views));
  check("Rows carry sign-in for whoever sees access", data(everyone)?.items.every((row) => row.signIn?.state));
  const notSignedIn = await call("GET", `${people}?view=NotSignedIn&pageSize=100`, null, amira);
  check("Not signed in holds only people who don't sign in",
    data(notSignedIn)?.items.every((row) => row.signIn.state !== "SignsIn") && data(notSignedIn).totalCount === views.notSignedIn);

  const csv = await fetch(`${BASE}${people}/export?format=Csv&view=Everyone`, { headers: { Authorization: `Bearer ${amira}` } });
  const text = await csv.text();
  check("Export gives the filtered people as CSV, sign-in included", csv.ok && /text\/csv/.test(csv.headers.get("content-type")) && text.includes("Sign-in")
    && text.trim().split("\r\n").length === views.everyone + 1);
  const xlsx = await fetch(`${BASE}${people}/export?format=Xlsx`, { headers: { Authorization: `Bearer ${amira}` } });
  check("Export gives Excel too", xlsx.ok && /spreadsheetml/.test(xlsx.headers.get("content-type")));

  check("An employee can't list People", (await call("GET", people, null, aicha)).status === 403);
  check("An employee can't export", (await fetch(`${BASE}${people}/export`, { headers: { Authorization: `Bearer ${aicha}` } })).status === 403);
  const directory = await call("GET", `${people}/directory`, null, aicha);
  const dirPeople = data(directory)?.people ?? [];
  check("An employee browses the directory", directory.status === 200 && dirPeople.length === views.everyone, `${dirPeople.length}`);
  check("The directory holds no employment dates or sign-in", dirPeople.every((person) => !("employmentStart" in person) && !("signIn" in person)));
  check("The directory knows who's looking", Boolean(data(directory)?.viewerEmployeeKey));
  check("An employee can't read or send invitations",
    (await call("GET", `${people}/invitations`, null, aicha)).status === 403
      && (await call("POST", `${people}/invitations`, { audience: "NotSignedIn" }, aicha)).status === 403);

  const plan = await call("GET", `${people}/invitations`, null, amira);
  check("HR reads who each choice reaches", plan.status === 200 && typeof data(plan)?.notSignedIn === "number", JSON.stringify({ ...data(plan), scheduled: undefined }));
  const sendAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const planned = await call("POST", `${people}/invitations`, { audience: "NotSignedIn", sendAt }, amira);
  const scheduleId = data(planned)?.scheduled?.id;
  check("Invitations plan for later", planned.status === 200 && Boolean(scheduleId));
  check("A moment in the past is refused", (await call("POST", `${people}/invitations`, { audience: "Managers", sendAt: "2020-01-01T09:00:00Z" }, amira)).status === 400);
  check("The plan lists it", data(await call("GET", `${people}/invitations`, null, amira))?.scheduled.some((item) => item.id === scheduleId));
  check("Another company can't cancel it", (await call("DELETE", `${people}/invitations/${scheduleId}`, null, elsewhere)).status === 404);
  check("HR cancels it", (await call("DELETE", `${people}/invitations/${scheduleId}`, null, amira)).status === 204);
  check("Cancelled twice is not found", (await call("DELETE", `${people}/invitations/${scheduleId}`, null, amira)).status === 404);

  const target = data(notSignedIn).items.find((row) => row.signIn.state === "NotInvited" && row.workEmail);
  if (check("Someone not invited yet with a work email", Boolean(target), target?.displayName)) {
    const sent = await call("POST", `${people}/invitations`, { audience: "Chosen", employeeIds: [target.employeeId] }, amira);
    check("Inviting one person now sends it", sent.status === 200 && data(sent)?.invited === 1, JSON.stringify(data(sent)));
    const row = data(await call("GET", `${people}?q=${encodeURIComponent(target.workEmail)}`, null, amira))?.items[0];
    check("Their row says Invited", row?.signIn.state === "Invited");
    const mail = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${target.workEmail}`)}`)).json();
    check("The invitation email arrived", (mail.messages ?? []).length > 0);
    check("Another company can't invite them",
      data(await call("POST", `${people}/invitations`, { audience: "Chosen", employeeIds: [target.employeeId] }, elsewhere))?.invited !== 1);
    await call("POST", `/api/corehr/workforce/access-subjects/${target.employeeId}/withdraw`, {}, amira);
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})();
