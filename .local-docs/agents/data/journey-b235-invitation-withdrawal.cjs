// Through the shell API only. Repairs the recorded Ala invitation, exercises revocation,
// permissions, scheduling and re-invitation, and leaves the final invitation withdrawn.
// node .local-docs/agents/data/journey-b235-invitation-withdrawal.cjs
const path = require("path");
const { call, login, inviteToken, PASSWORD } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));
const data = (r) => r.json?.data;
const results = [];
function check(label, condition) {
  results.push(Boolean(condition));
  console.log(`${condition ? "PASS" : "FAIL"} ${label}`);
  if (!condition) throw new Error(label);
}

(async () => {
  const hr = await login("amira.khelifi@example.test");
  const employee = await login("aicha.bouazizi@example.test");
  const other = await login(process.env.B235_OTHER ?? "amira.khelifi@midyear-5.example.test");
  const people = "/api/corehr/employees/people";
  const row = async () => data(await call("GET", `${people}?q=ala.bouzgarrou`, null, hr))?.items[0];
  const person = await row();
  check("Recorded person is available", person?.workEmail === "ala.bouzgarrou@example.test");
  const subject = `/api/corehr/workforce/access-subjects/${person.employeeId}`;
  const accept = (token) => call("POST", `/api/identity/invites/${token}/accept`, { password: PASSWORD });
  const validate = (token) => call("GET", `/api/identity/invites/${token}`);
  const send = () => call("POST", `${people}/invitations`, { audience: "Chosen", employeeIds: [person.employeeId] }, hr);

  // Both pending (first run) and withdrawn (re-run) use the supported resend path.
  check("Resend issues a usable invitation", data(await call("POST", `${subject}/resend`, {}, hr))?.outcome === "Ok");
  const first = await inviteToken(person.workEmail);
  check("Delivered link is valid", (await validate(first.token)).status === 200);
  check("Pending person displays Invited", (await row()).signIn.state === "Invited");
  const duplicate = await send();
  check("Inviting an already pending person does not issue another invitation", duplicate.status === 200 && data(duplicate)?.invited === 0);
  check("Pending invitation link is unchanged", (await inviteToken(person.workEmail)).token === first.token);

  check("Signed-out withdrawal is refused", (await call("POST", `${subject}/withdraw`, {})).status === 401);
  check("Employee withdrawal is refused", (await call("POST", `${subject}/withdraw`, {}, employee)).status === 403);
  check("Other tenant cannot withdraw", (await call("POST", `${subject}/withdraw`, {}, other)).status === 404);
  check("Unauthorized attempts leave the link valid", (await validate(first.token)).status === 200);
  check("HR withdraws the invitation", data(await call("POST", `${subject}/withdraw`, {}, hr))?.outcome === "Ok");
  check("People now displays Not invited", (await row()).signIn.state === "NotInvited");
  const access = await call("GET", `${people}/${person.employeeKey}/access-status`, null, hr);
  check("Access tab explains withdrawal", data(access)?.detail?.includes("withdrawn"));
  check("Withdrawn link is gone", (await validate(first.token)).status === 410);
  check("Withdrawn link cannot create an account", (await accept(first.token)).status === 404);
  check("Withdrawal is safe to repeat", data(await call("POST", `${subject}/withdraw`, {}, hr))?.outcome === "Ok");

  const planned = await call("POST", `${people}/invitations`, {
    audience: "Chosen", employeeIds: [person.employeeId], sendAt: new Date(Date.now() + 86400000).toISOString(),
  }, hr);
  const scheduleId = data(planned)?.scheduled?.id;
  check("Invitation can still be scheduled for later", planned.status === 200 && scheduleId);
  try {
    check("Schedule appears in the invitation plan", data(await call("GET", `${people}/invitations`, null, hr))?.scheduled.some((s) => s.id === scheduleId));
    check("Other tenant cannot cancel the schedule", (await call("DELETE", `${people}/invitations/${scheduleId}`, null, other)).status === 404);
  } finally {
    check("HR cancels the test schedule", (await call("DELETE", `${people}/invitations/${scheduleId}`, null, hr)).status === 204);
  }
  check("Scheduling never revives the withdrawn link", (await validate(first.token)).status === 410);

  const reinvited = await send();
  check("Re-inviting a withdrawn person creates a new invitation", reinvited.status === 200 && data(reinvited)?.invited === 1);
  const second = await inviteToken(person.workEmail);
  check("Re-invitation has a fresh valid credential", second.token !== first.token && (await validate(second.token)).status === 200);
  check("Original withdrawn credential stays unusable after re-invitation", (await accept(first.token)).status === 404);
  check("Re-invited person displays Invited", (await row()).signIn.state === "Invited");
  check("Final invitation is withdrawn", data(await call("POST", `${subject}/withdraw`, {}, hr))?.outcome === "Ok");
  check("Final withdrawn credential cannot activate", (await accept(second.token)).status === 404);
  check("Person finishes Not invited", (await row()).signIn.state === "NotInvited");
  check("No account was created", (await call("POST", "/api/identity/auth/login", { email: person.workEmail, password: PASSWORD })).status === 401);
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => {
  console.log(`Passed ${results.filter(Boolean).length} | Failed ${results.filter((r) => !r).length} | Skipped 0`);
});
