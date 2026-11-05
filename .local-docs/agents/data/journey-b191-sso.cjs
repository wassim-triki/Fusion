// B-191 single sign-on through the shell, with the local test provider. Creates one fictional company
// ("SSO Journey <stamp>", domain sso-<stamp>.example.test); no existing tenant is changed except reads.
// Run: node .local-docs/agents/data/journey-b191-sso.cjs   (stack up; FUSION_LOCAL_PASSWORD set)
const fs = require("node:fs");
const path = require("node:path");
const { BASE, MAILPIT, PASSWORD, call, login, inviteToken } = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");

// The local test provider's client secret (Development only; appsettings.Development.json). Not a real secret.
const TEST_SECRET = "fusion-local-test-provider";
let passed = 0;
let failed = 0;
function check(name, condition, detail) {
  if (condition) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 400)}` : ""}`); }
}
const data = (response) => response.json?.data;
const code = (response) => response.json?.details?.code ?? response.json?.code ?? null;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A browser: a cookie jar for localhost:3000, redirects followed by hand. */
function browser(token) {
  const jar = new Map();
  async function send(method, url, { body, form, bearer = token } = {}) {
    const target = url.startsWith("http") ? url : `${BASE}${url}`;
    const headers = { Accept: "application/json" };
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    let payload;
    if (form) { headers["Content-Type"] = "application/x-www-form-urlencoded"; payload = new URLSearchParams(form).toString(); }
    else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
    const response = await fetch(target, { method, headers, body: payload, redirect: "manual" });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair, ...attributes] = cookie.split(";");
      const [name, ...value] = pair.split("=");
      const expired = attributes.some((a) => /max-age=0/i.test(a) || /expires=thu, 01 jan 1970/i.test(a));
      if (expired) jar.delete(name.trim()); else jar.set(name.trim(), value.join("="));
    }
    const text = await response.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: response.status, json, location: response.headers.get("location") };
  }
  return { send, jar };
}

/** Starts a flow, signs the person in at the test provider, follows the callback; answers the landing and the browser. */
async function roundTrip(b, request, person) {
  const started = await b.send("POST", "/api/identity/sso/flows", { body: request });
  if (started.status !== 200) return { started };
  const authorize = new URL(data(started).authorizeUrl);
  const form = Object.fromEntries(authorize.searchParams);
  Object.assign(form, { email_verified: "true", workspace: "true", xms_edov: "true" }, person);
  const atProvider = await b.send("POST", authorize.pathname, { form, bearer: null });
  const callback = await b.send("GET", new URL(atProvider.location).pathname + new URL(atProvider.location).search, { bearer: null });
  return { started, landing: callback.location };
}
async function result(b) {
  return b.send("POST", "/api/identity/sso/result", { bearer: null });
}
async function signInWith(provider, email, person = {}) {
  const b = browser(null);
  const trip = await roundTrip(b, { purpose: "signIn", provider, email }, { email, ...person });
  if (!trip.landing) return { status: trip.started.status, code: code(trip.started) };
  const r = await result(b);
  return { status: r.status, session: data(r)?.session ?? null, refusal: data(r)?.refusal ?? null };
}

async function main() {
  if (!PASSWORD) throw new Error("Set FUSION_LOCAL_PASSWORD.");
  const stamp = Date.now().toString(36);
  const domain = `sso-${stamp}.example.test`;
  const name = `SSO Journey ${stamp}`;
  const admin = `amira.khelifi@${domain}`;
  const platform = await login("admin@ey-hr.com");

  // 1. Provision; the first administrator activates with Google.
  const made = await call("POST", "/api/identity/platform-admin/tenants", {
    name, locale: "en-US", timeZone: "Africa/Tunis", industry: "Technology", modules: ["Performance"],
    administratorEmail: admin, administratorFirstName: "Amira", administratorLastName: "Khelifi", idempotencyKey: `b191-${stamp}`,
  }, platform);
  check("Fictional company provisioned", made.status === 201 || made.status === 200, made.json);
  let credential;
  for (let i = 0; i < 30 && !credential; i++) {
    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=to:${encodeURIComponent(admin)}`)).json();
    if (list.messages?.[0]) {
      const mail = await (await fetch(`${MAILPIT}/api/v1/message/${list.messages[0].ID}`)).json();
      credential = `${mail.Text}\n${mail.HTML}`.match(/[?&]credential=([^&"'<>\s]+)/)?.[1];
    }
    if (!credential) await pause(500);
  }
  credential = decodeURIComponent(credential);
  const inspect = data(await call("GET", `/api/identity/tenant-activation?credential=${encodeURIComponent(credential)}`));
  check("Activation offers Microsoft and Google beside the password", inspect.waysIn?.password && inspect.waysIn.providers.map((p) => p.key).join() === "microsoft,google", inspect.waysIn);
  const adminBrowser = browser(null);
  const activation = await roundTrip(adminBrowser, { purpose: "invitation", provider: "google", invitation: { kind: "bootstrap", credential } },
    { email: admin, given_name: "Amira", family_name: "Khelifi" });
  check("The provider sends the browser to the landing page, with nothing in the address", activation.landing === `${BASE}/auth/sso/complete`, activation.landing);
  const activated = data(await result(adminBrowser));
  check("First administrator activated with Google and signed in", Boolean(activated?.session?.tenantId), activated);
  let adminToken = activated.session.accessToken;
  const tenantId = activated.session.tenantId;
  check("No password was set", (await call("POST", "/api/identity/auth/login", { email: admin, password: PASSWORD })).status === 401);

  // 2. The administrator sets a password, confirming through Google.
  const confirmBrowser = browser(adminToken);
  const confirm = await roundTrip(confirmBrowser, { purpose: "confirm", provider: "google", returnTo: "/core/settings/sign-in" }, { email: admin });
  check("Confirmation returns to the page it started from", confirm.landing === `${BASE}/core/settings/sign-in?confirmed=sso`, confirm.landing);
  const setPassword = await call("POST", "/api/identity/account/password", { newPassword: PASSWORD, sso: true }, adminToken);
  check("Password set after confirming through the provider", setPassword.status === 200, setPassword.json);
  adminToken = await login(admin);

  // 3. Connect the company's provider: a wrong secret fails the test with what the provider said; the right one passes.
  const issuer = `${BASE}/api/identity/dev-oidc/company`;
  const save = (secret) => call("PUT", "/api/identity/sso/settings/connection", {
    kind: "OpenIdConnect", displayName: "SSO Journey Login", issuer, clientId: "sso-journey", clientSecret: secret, password: PASSWORD,
  }, adminToken);
  check("Connection saved", (await save("not-the-secret")).status === 200);
  check("Domain listed", (await call("POST", "/api/identity/sso/settings/domains", { domain }, adminToken)).status === 200);
  const tester = browser(adminToken);
  const failedTest = await roundTrip(tester, { purpose: "test", provider: "company" }, { email: admin });
  check("Test lands back on Settings › Sign-in", failedTest.landing === `${BASE}/core/settings/sign-in?sso=tested`, failedTest.landing);
  let settings = data(await call("GET", "/api/identity/sso/settings", null, adminToken));
  check("A wrong secret fails the test with the provider's answer", settings.connection.lastTestOutcome === "failed" && /client secret/.test(settings.connection.lastTestMessage), settings.connection);
  check("The secret never comes back", !JSON.stringify(settings).includes("not-the-secret"));
  check("Right secret saved", (await save(TEST_SECRET)).status === 200);
  await roundTrip(tester, { purpose: "test", provider: "company" }, { email: admin });
  settings = data(await call("GET", "/api/identity/sso/settings", null, adminToken));
  check("Testing as themselves passes, proves the domain and links them",
    settings.connection.status === "Tested" && settings.domains[0].provedAt && settings.checks.freshOwnLink, settings);

  // 4. Two people join; one accepts through the company's provider, one with a password.
  const first = await call("POST", "/api/corehr/me/first-person", { firstName: "Amira", lastName: "Khelifi", jobTitle: "Director", companyName: name }, adminToken);
  check("Administrator is the company's first person", first.status === 200, first.json);
  adminToken = await login(admin);
  // Hiring someone who reports to the administrator moves their authority a moment later (B-279): sign in again then.
  const asAdmin = async (method, url, body) => {
    const first = await call(method, url, body, adminToken);
    if (first.status !== 401) return first;
    await pause(300);
    adminToken = await login(admin);
    return call(method, url, body, adminToken);
  };
  const me = data(await call("GET", "/api/corehr/workforce/me", null, adminToken)).employee;
  const jobs = data(await call("GET", "/api/corehr/catalog/jobs", null, adminToken));
  async function hire(firstName, lastName) {
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${domain}`;
    const hired = await asAdmin("POST", "/api/corehr/employees/hire", {
      firstName, lastName, workEmail: email, employeeNumberMode: "Generated", startDate: `${new Date().toISOString().slice(0, 10)}T00:00:00Z`,
      orgUnitId: me.orgUnit.orgUnitId, jobId: jobs.find((job) => !job.isRetired)?.id, primaryManagerEmployeeId: me.employeeId,
    });
    check(`${firstName} hired`, hired.status === 201, hired.json);
    const person = data(await asAdmin("GET", `/api/corehr/employees/people?q=${encodeURIComponent(email)}`)).items.find((p) => p.workEmail === email);
    const sent = await asAdmin("POST", "/api/corehr/employees/people/invitations", { audience: "Chosen", employeeIds: [person.employeeId] });
    check(`${firstName} invited`, sent.status === 200, sent.json);
    return { email, token: (await inviteToken(email)).token };
  }
  const aicha = await hire("Aicha", "Bouazizi");
  const sami = await hire("Sami", "Trabelsi");
  const aichaInvite = data(await call("GET", `/api/identity/invites/${encodeURIComponent(aicha.token)}`));
  check("The invitation offers the company's provider first", aichaInvite.waysIn.providers[0]?.key === "company", aichaInvite.waysIn);
  const aichaBrowser = browser(null);
  await roundTrip(aichaBrowser, { purpose: "invitation", provider: "company", invitation: { kind: "workforce", credential: aicha.token } }, { email: aicha.email });
  const aichaResult = data(await result(aichaBrowser));
  check("Aicha accepts through the company's provider and is signed in without a password", Boolean(aichaResult?.session?.accessToken), aichaResult);
  check("Aicha has no password", (await call("POST", "/api/identity/auth/login", { email: aicha.email, password: PASSWORD })).status === 401);
  const uninvited = await signInWith("company", `nobody@${domain}`);
  check("An uninvited address is refused and nothing is created", uninvited.refusal?.code === "no_account", uninvited);
  check("Sami accepts with a password", (await call("POST", `/api/identity/invites/${encodeURIComponent(sami.token)}/accept`, { password: PASSWORD, firstName: "Sami", lastName: "Trabelsi" })).status === 201);
  const samiSession = data(await call("POST", "/api/identity/auth/login", { email: sami.email, password: PASSWORD }));

  // 5. Requiring the provider ends Sami's password session; the company's provider still works for him.
  const on = await asAdmin("POST", "/api/identity/sso/settings/requirement", { on: true });
  check("Requirement turned on", on.status === 200 && data(on).connection.requiredAt, on.json);
  check("Sami's password session ended", (data(on)?.connection.requiredEndedSessions ?? 0) >= 1, data(on)?.connection);
  const stale = await call("GET", "/api/corehr/workforce/me", null, samiSession.accessToken);
  check("Sami's next call is turned away (revision-stale)", stale.status === 401 && stale.json?.reason === "revision-stale", stale.json);
  const refresh = await call("POST", "/api/identity/auth/refresh", { refreshToken: samiSession.refreshToken });
  check("Refresh says the company's provider is required", refresh.status === 401 && code(refresh) === "sso_required", refresh.json);
  check("Sami's password sign-in is refused", (await call("POST", "/api/identity/auth/login", { email: sami.email, password: PASSWORD })).status === 401);
  check("Sami signs in through the company's provider", Boolean((await signInWith("company", sami.email)).session));
  const google = await signInWith("google", sami.email);
  check("Google is refused for him: the company requires its own", google.refusal?.code === "company_requires", google);
  const microsoft = await signInWith("microsoft", sami.email);
  check("Microsoft too", microsoft.refusal?.code === "company_requires", microsoft);

  // 6. The administrator's password still works, and its use is recorded.
  adminToken = await login(admin);
  const activity = await call("GET", "/api/identity/tenant-access/activity?pageSize=50", null, adminToken);
  check("Administrator's password sign-in recorded while required", JSON.stringify(activity.json).includes("password.used_while_required"), activity.status);

  // 7. Another company sees only its own; Fusion's own staff keep their password and never sign in through a provider.
  const carthage = await login("amira.khelifi@example.test");
  const carthageSettings = data(await call("GET", "/api/identity/sso/settings", null, carthage));
  check("Carthage's administrator reads only Carthage", carthageSettings && !JSON.stringify(carthageSettings).includes(domain), carthageSettings);
  const aichaId = aichaResult.session.userId;
  const aichaLinks = data(await call("GET", `/api/identity/sso/links?userId=${aichaId}`, null, adminToken));
  check("The company's administrator sees Aicha's link", aichaLinks?.length === 1 && aichaLinks[0].provider === "company", aichaLinks);
  check("Carthage can't read Aicha's links", (await call("GET", `/api/identity/sso/links?userId=${aichaId}`, null, carthage)).status === 404);
  check("Carthage can't remove Aicha's link", (await call("DELETE", `/api/identity/sso/links/${aichaLinks[0].id}`, null, carthage)).status === 404);
  check("Carthage can't remove this company's domain", (await call("DELETE", `/api/identity/sso/settings/domains/${domain}`, { password: PASSWORD }, carthage)).status === 404);
  check("The platform operator signs in with a password", Boolean(await login("admin@ey-hr.com")));
  const operator = await signInWith("google", "admin@ey-hr.com");
  check("The operator through Google is refused", operator.refusal?.code === "operator", operator);

  // 8. Turning the requirement off asks who you are.
  check("Turning off without confirming is refused", code(await call("POST", "/api/identity/sso/settings/requirement", { on: false }, adminToken)) === "password-incorrect");
  check("Turning off with the password works", (await call("POST", "/api/identity/sso/settings/requirement", { on: false, password: PASSWORD }, adminToken)).status === 200);
  check("Sami's password works again", (await call("POST", "/api/identity/auth/login", { email: sami.email, password: PASSWORD })).status === 200);

  fs.writeFileSync(path.join(__dirname, "b191.local.json"), JSON.stringify({ tenantId, name, domain, admin, aicha: aicha.email, sami: sami.email }, null, 2));
  console.log(`Company: ${name} (${domain}); administrator ${admin}`);
}

main()
  .catch((error) => { failed++; console.error(error.stack ?? error.message); })
  .finally(() => {
    console.log(`Passed ${passed} | Failed ${failed} | Skipped 0`);
    if (failed) process.exitCode = 1;
  });
