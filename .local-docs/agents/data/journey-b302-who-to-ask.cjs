// B-302: who a refused person can ask, through the shell. Reads only; changes no data.
// A Carthage employee and manager read Carthage's administrators; an administrator gets no names; a member of another
// company reads only theirs, even with a header naming Carthage; the platform administrator and no token get nothing.
// Run: node .local-docs/agents/data/journey-b302-who-to-ask.cjs   (stack up; FUSION_LOCAL_PASSWORD set)
const { BASE, call, login } = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");

const PATH = "/api/identity/tenant-context/administrators";
let passed = 0;
let failed = 0;
function check(name, condition, detail) {
  if (condition) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ""}`); }
}

(async () => {
  const leila = await call("GET", PATH, null, await login("leila.baccouche@example.test"));
  const people = leila.json?.data?.administrators ?? [];
  check("an employee reads their company's administrators", leila.status === 200 && people.length > 0 && leila.json.data.callerIsAdministrator === false, leila);
  check("at most three", people.length <= 3, people);
  check("name, first name and email, nothing else", people.every((p) => Object.keys(p).sort().join() === "email,firstName,name"), people);
  check("Carthage's own people", people.every((p) => p.email.endsWith("@example.test")), people);

  const mariam = await call("GET", PATH, null, await login("mariam.gharbi@example.test"));
  check("a manager reads the same answer", JSON.stringify(mariam.json?.data) === JSON.stringify(leila.json?.data), mariam);

  const amira = await call("GET", PATH, null, await login("amira.khelifi@example.test"));
  check("an administrator is told so, with no names", amira.status === 200 && amira.json.data.callerIsAdministrator === true && amira.json.data.administrators.length === 0, amira);

  const carthage = (await call("GET", "/api/identity/tenant-context/tenant-summary", null, await login("leila.baccouche@example.test"))).json.data.tenantId;
  const outsiderToken = await login("leila.baccouche@fresh-5.example.test"); // the Fresh demo company
  const outsider = await call("GET", PATH, null, outsiderToken);
  const carthageEmails = new Set(people.map((p) => p.email));
  check("another company never sees Carthage's", outsider.status === 200 && !(outsider.json.data.administrators ?? []).some((p) => carthageEmails.has(p.email)), outsider);

  const forged = await fetch(`${BASE}${PATH}`, { headers: { Authorization: `Bearer ${outsiderToken}`, "X-Tenant-Id": carthage } });
  const forgedBody = await forged.json();
  check("a header naming Carthage changes nothing", JSON.stringify(forgedBody.data) === JSON.stringify(outsider.json.data), forgedBody);

  const platform = await call("GET", PATH, null, await login("admin@ey-hr.com"));
  check("the platform administrator gets nothing", platform.status >= 400 && platform.status < 500 && !platform.json?.data, platform);
  console.log(`    (platform administrator answered ${platform.status})`);

  const anonymous = await call("GET", PATH);
  check("no token gets a 401", anonymous.status === 401, anonymous);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
