// B-231 + B-204, through the shell. Person › Access › History: HR reads a person's account story (Yasmine Trabelsi's
// pending invitation from B-205, Aicha Bouazizi's accepted account); an employee is refused; another company and a
// forged Carthage header get nothing; no token 401. B-204: Mariam Gharbi (manager) praises Aicha and the Performance
// email that reaches Mailpit carries Carthage's brand ("Sent by Carthage … with Fusion", its colour, its logo).
// Writes one praise from Mariam to Aicha per run.
// Run: node .local-docs/agents/data/journey-b231-b204.cjs   (stack up; FUSION_LOCAL_PASSWORD set)
const { BASE, call, login } = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");

let passed = 0;
let failed = 0;
function check(name, condition, detail) {
  if (condition) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ""}`); }
}
const idOf = (key) => {
  const hex = key.replace(/^E-/, "").toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const history = (id, token) => call("GET", `/api/corehr/workforce/access-subjects/${id}/history`, null, token);
const MAILPIT = "http://localhost:8025/api/v1";

(async () => {
  const amira = await login("amira.khelifi@example.test");
  const mariam = await login("mariam.gharbi@example.test");
  const aicha = await login("aicha.bouazizi@example.test");
  const people = (await call("GET", "/api/corehr/reports/front-page", null, amira)).json.data.people;
  const yasmineId = idOf(people.find((p) => p.name === "Yasmine Trabelsi").employeeKey);
  const aichaId = idOf(people.find((p) => p.name === "Aicha Bouazizi").employeeKey);

  // B-231
  const pending = await history(yasmineId, amira);
  const kinds = (pending.json?.data ?? []).map((e) => e.kind);
  check("HR reads a pending invitation's story", pending.status === 200 && kinds.includes("Invited"), pending.json);
  const invited = pending.json.data.find((e) => e.kind === "Invited");
  check("it names who invited", invited?.actorName === "Amira Khelifi", invited);
  check("it says where it went", pending.json.data.some((e) => e.kind === "Delivered" && e.email === "yasmine.trabelsi@example.test"), pending.json.data);
  const active = await history(aichaId, amira);
  const aichaKinds = (active.json?.data ?? []).map((e) => e.kind);
  check("an active account's story ends with acceptance and the last sign-in, newest first",
    aichaKinds[0] === "SignedIn" && aichaKinds.includes("Accepted"), aichaKinds);
  console.log("Aicha:", JSON.stringify(active.json.data));

  const refused = await history(yasmineId, aicha);
  check("an employee may not read someone's account story", refused.status === 403, refused.status);
  check("a manager without sign-in access is refused too", (await history(aichaId, mariam)).status === 403);

  const outsider = await login("leila.baccouche@fresh-5.example.test");
  const foreign = await history(yasmineId, outsider);
  check("another company gets nothing", foreign.status === 403 || foreign.status === 404 || (foreign.json?.data ?? []).length === 0, foreign);
  const carthage = (await call("GET", "/api/identity/tenant-context/tenant-summary", null, aicha)).json.data.tenantId;
  const forged = await fetch(`${BASE}/api/corehr/workforce/access-subjects/${yasmineId}/history`,
    { headers: { Authorization: `Bearer ${outsider}`, "X-Tenant-Id": carthage } });
  const forgedBody = await forged.json().catch(() => null);
  check("a header naming Carthage changes nothing", forged.status >= 400 || (forgedBody?.data ?? []).length === 0, forgedBody);
  check("no token gets nothing", (await fetch(`${BASE}/api/corehr/workforce/access-subjects/${yasmineId}/history`)).status === 401);

  // B-204
  const values = (await call("GET", "/api/performance/values", null, mariam)).json.data;
  const since = new Date();
  const praise = await call("POST", "/api/performance/praise", {
    id: crypto.randomUUID(), recipientEmployeeIds: [aichaId], competencyId: values[0].id,
    message: "Thanks for keeping the launch checklist up to date.",
  }, mariam);
  check("Mariam praises Aicha", praise.status === 200 || praise.status === 201, praise.json);
  let mail = null;
  for (let i = 0; i < 24 && !mail; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const list = (await (await fetch(`${MAILPIT}/messages?limit=20`)).json()).messages;
    mail = list.find((m) => /fusion-performance/.test(m.MessageID) && m.To[0].Address === "aicha.bouazizi@example.test"
      && new Date(m.Created) >= since);
  }
  check("the praise email reaches Mailpit", Boolean(mail));
  if (mail) {
    const full = await (await fetch(`${MAILPIT}/message/${mail.ID}`)).json();
    check("it closes with the company's sign-off", /Sent by Carthage[^<]* with Fusion/.test(full.HTML), full.Text?.slice(-300));
    check("it no longer says 'Sent by Fusion for'", !/Sent by Fusion for/.test(full.HTML));
    console.log(`brand colour on the button: ${/#2f5fd0/i.test(full.HTML) ? "#2f5fd0" : "Fusion's"}; logo: ${/cid:company-logo/.test(full.HTML) ? "yes" : "no"}`);
    console.log(`Mailpit: http://localhost:8025/view/${mail.ID}`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
