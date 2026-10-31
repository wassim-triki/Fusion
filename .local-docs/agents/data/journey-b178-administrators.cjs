// B-178 API journey, through the shell like the browser:
//   node .local-docs/agents/data/journey-b178-administrators.cjs
// In Carthage Digital Group (two administrators: Amira Khelifi and the Sidebar Admin test account):
// - Administrators: removing one would leave fewer than two, refused; Mariam (manager) and Leila (employee) can't add,
//   list candidates or see the page's data; a wrong or missing password and someone from another company are refused;
//   Amira adds Mariam with her password (three), Mariam's old token is turned away and a refresh gives her the
//   administrators' permissions, Amira removes her again (two). History and Change history keep both.
// - Seeing Fusion as someone: Amira sees Fusion as Leila. The token is Leila's authority (no roles page), reads work,
//   every change is refused (Identity, Core HR, Performance, sign-out), no nesting; ending it turns the token away.
//   Mariam can't start one; Amira can't see as herself or as someone from another company; removing the viewer's
//   administration ends their open view. Change history records the view.
// - B-213: adding Leila to HR turns her old token away; her refresh token gives her HR's permissions without signing
//   in again; HR's holders are restored at the end.
// Leaves Carthage as it found it (two administrators, HR's holders).
const path = require("path");
const { BASE, call, login, PASSWORD } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const data = (r) => r.json?.data;
const code = (r) => r.json?.details?.code ?? r.json?.type ?? null;
const claims = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
const results = [];
function check(label, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  return ok;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function session(email) {
  const r = await call("POST", "/api/identity/auth/login", { email, password: PASSWORD });
  return data(r);
}

async function hrRole(amira) {
  const overview = data(await call("GET", "/api/identity/core-access/roles", null, amira));
  const hr = overview.roles.find((role) => role.isBuiltIn && role.name === "HR");
  return data(await call("GET", `/api/identity/core-access/roles/${hr.id}`, null, amira));
}

async function saveHolders(amira, detail, chosenUserIds) {
  const role = detail.role;
  const r = await fetch(`${BASE}/api/identity/core-access/roles/${role.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${amira}`, "If-Match": `"${role.version}"` },
    body: JSON.stringify({ name: role.name, description: role.description, cells: role.cells, holderKind: role.holderKind,
      conditions: role.conditions, chosenUserIds }),
  });
  return r.status;
}

(async () => {
  const amira = await login("amira.khelifi@example.test");
  const mariam = await login("mariam.gharbi@example.test");
  const leila = await login("leila.baccouche@example.test");
  const operator = await login("admin@ey-hr.com");
  const elsewhere = claims(await login("amira.khelifi@midyear-5.example.test")).sub
    ?? claims(await login("amira.khelifi@midyear-5.example.test"))["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"];
  const userIdOf = async (name) =>
    data(await call("GET", `/api/identity/tenant-access/administrators/candidates?search=${encodeURIComponent(name)}`, null, amira))
      ?.find((candidate) => candidate.name.startsWith(name))?.userId;
  const mariamId = await userIdOf("Mariam Gharbi");
  const leilaId = await userIdOf("Leila Baccouche");

  // ── Administrators ──
  const admins = data(await call("GET", "/api/identity/tenant-access/administrators", null, amira));
  check("Amira reads the administrators", admins?.length === 2, admins?.map((item) => item.name).join(", "));
  check("both carry the keep-two reason", admins.every((item) => item.blockedReason));
  const sidebar = admins.find((item) => item.email.startsWith("sidebar.admin"));
  const refusedRemove = await call("POST", `/api/identity/tenant-access/administrators/${sidebar.membershipId}/authority:revoke`, {}, amira);
  check("removing one of two is refused", refusedRemove.status === 409 && code(refusedRemove) === "too-few-administrators", `${refusedRemove.status} ${code(refusedRemove)}`);

  check("Mariam can't add an administrator",
    (await call("POST", "/api/identity/tenant-access/administrators", { userId: mariamId, password: PASSWORD }, mariam)).status === 403);
  check("Mariam can't list candidates", (await call("GET", "/api/identity/tenant-access/administrators/candidates", null, mariam)).status === 403);
  check("Leila can't read the administrators", (await call("GET", "/api/identity/tenant-access/administrators", null, leila)).status === 403);
  check("Fusion's operator has no company here", [400, 403].includes((await call("GET", "/api/identity/tenant-access/administrators", null, operator)).status));
  const operatorCandidates = data(await call("GET", "/api/identity/tenant-access/administrators/candidates?search=ey-hr", null, amira)) ?? [];
  check("Fusion's staff never appear as candidates", operatorCandidates.length === 0, `${operatorCandidates.length}`);

  const wrong = await call("POST", "/api/identity/tenant-access/administrators", { userId: mariamId, password: "not-my-password" }, amira);
  check("a wrong password is refused", wrong.status === 403 && code(wrong) === "password-incorrect", `${wrong.status} ${code(wrong)}`);
  const missing = await call("POST", "/api/identity/tenant-access/administrators", { userId: mariamId }, amira);
  check("no password is refused", missing.status === 403 && code(missing) === "password-incorrect", `${missing.status}`);
  const foreign = await call("POST", "/api/identity/tenant-access/administrators", { userId: elsewhere, password: PASSWORD }, amira);
  check("someone from another company is refused", foreign.status === 409 && code(foreign) === "not-eligible", `${foreign.status} ${code(foreign)}`);
  check("the old password-less grant is gone",
    (await call("POST", `/api/identity/tenant-access/administrators/${sidebar.membershipId}/authority:grant`, {}, amira)).status === 404);
  check("the old administrator email invitation is gone",
    [404, 405].includes((await call("POST", "/api/identity/tenant-access/invitations", { email: "x@example.test" }, amira)).status));

  const mariamBefore = await session("mariam.gharbi@example.test");
  const added = await call("POST", "/api/identity/tenant-access/administrators", { userId: mariamId, password: PASSWORD }, amira);
  check("Amira makes Mariam an administrator with her password", added.status === 200, `${added.status}`);
  const three = data(await call("GET", "/api/identity/tenant-access/administrators", null, amira));
  check("three administrators, none blocked", three.length === 3 && three.every((item) => !item.blockedReason));
  const stale = await call("GET", "/api/identity/tenant-access/summary", null, mariamBefore.accessToken);
  check("Mariam's old token is turned away", stale.status === 401, `${stale.status} ${stale.json?.reason ?? ""}`);
  const refreshed = data(await call("POST", "/api/identity/auth/refresh", { refreshToken: mariamBefore.refreshToken }));
  check("her refresh gives her the administrators' permissions",
    refreshed?.effectivePermissions?.some((grant) => grant.permissionKey === "access.assignments.manage"));
  const mariamAdmin = refreshed.accessToken;

  // An administrator's open view ends when they stop being one.
  const mariamView = data(await call("POST", "/api/identity/view-as", { userId: leilaId }, mariamAdmin));
  check("Mariam, now an administrator, sees Fusion as Leila", Boolean(mariamView?.session?.accessToken));

  const mariamRow = three.find((item) => item.userId === mariamId);
  const removed = await call("POST", `/api/identity/tenant-access/administrators/${mariamRow.membershipId}/authority:revoke`, {}, amira);
  check("Amira removes Mariam again (three → two)", removed.status === 200, `${removed.status}`);
  const ended = await call("GET", "/api/corehr/workforce/me", null, mariamView.session.accessToken);
  check("Mariam's view ended with her administration", ended.status === 401, `${ended.status} ${ended.json?.reason ?? ""}`);

  const history = data(await call("GET", "/api/identity/tenant-access/administrators/history", null, amira));
  check("History keeps the grant", history.some((item) => item.kind === "administrator" && item.personName === "Mariam Gharbi" && item.actorName === "Amira Khelifi"));
  check("History keeps the removal", history.some((item) => item.kind === "removed" && item.personName === "Mariam Gharbi"));
  check("HR can't read the history (Leila)", (await call("GET", "/api/identity/tenant-access/administrators/history", null, leila)).status === 403);

  // ── Seeing Fusion as someone ──
  check("Mariam (not an administrator) can't see as someone",
    (await call("POST", "/api/identity/view-as", { userId: leilaId }, await login("mariam.gharbi@example.test"))).status === 403);
  check("Amira can't see as herself", (await call("POST", "/api/identity/view-as", { userId: claims(amira).sub ?? admins[0].userId }, amira)).status === 400
    || (await call("POST", "/api/identity/view-as", { userId: admins.find((item) => item.email.startsWith("amira")).userId }, amira)).status === 400);
  check("Amira can't see as someone from another company", (await call("POST", "/api/identity/view-as", { userId: elsewhere }, amira)).status === 404);

  const view = data(await call("POST", "/api/identity/view-as", { userId: leilaId }, amira));
  const token = view?.session?.accessToken;
  check("Amira sees Fusion as Leila", Boolean(token), `${view?.personName}, roles ${view?.roles?.map((role) => role.name).join(", ")}`);
  const viewClaims = claims(token);
  check("the token is Leila's, marked as a view, with no refresh token",
    view.session.userId === leilaId && Boolean(viewClaims.view_session) && view.session.refreshToken === "");
  check("reads work as Leila", (await call("GET", "/api/corehr/workforce/me", null, token)).status === 200);
  check("and with Leila's reach: no roles page", (await call("GET", "/api/identity/core-access/roles", null, token)).status === 403);
  const writes = [
    ["PUT", "/api/identity/account/language", { language: "fr" }],
    ["POST", "/api/identity/auth/logout", {}],
    ["POST", "/api/identity/view-as", { userId: mariamId }],
    ["POST", "/api/corehr/employees/people", {}],
    ["POST", "/api/performance/feedback", {}],
  ];
  for (const [method, url, body] of writes) {
    const r = await call(method, url, body, token);
    check(`read-only: ${method} ${url}`, r.status === 403 && r.json?.type === "read-only-view", `${r.status} ${r.json?.type ?? ""}`);
  }
  check("ending the view", (await call("POST", "/api/identity/view-as/end", {}, token)).status === 200);
  const afterEnd = await call("GET", "/api/corehr/workforce/me", null, token);
  check("the ended view's token is turned away", afterEnd.status === 401 && afterEnd.json?.reason === "view-ended", `${afterEnd.status} ${afterEnd.json?.reason ?? ""}`);

  const audit = data(await call("GET", "/api/identity/core-access/audit?take=50", null, amira)) ?? [];
  check("Change history records the view", audit.some((item) => item.action === "FusionSeenAs" && item.afterJson?.includes("Leila Baccouche")));
  check("and the grant, naming Mariam", audit.some((item) => item.action === "AdministratorAuthorityGranted" && item.afterJson?.includes("Mariam Gharbi") && item.actorName === "Amira Khelifi"));

  // ── B-213: a role change reaches a signed-in person without signing them out ──
  const before = await hrRole(amira);
  const chosen = before.holders.filter((holder) => holder.isChosen).map((holder) => holder.userId);
  const leilaSession = await session("leila.baccouche@example.test");
  try {
    check("HR + Leila saved", (await saveHolders(amira, before, [...chosen, leilaId])) === 200);
    let turnedAway = null;
    for (let i = 0; i < 10 && turnedAway?.status !== 401; i++) {
      turnedAway = await call("GET", "/api/corehr/workforce/me", null, leilaSession.accessToken);
      if (turnedAway.status !== 401) await sleep(1000);
    }
    check("Leila's old token is turned away", turnedAway.status === 401 && turnedAway.json?.reason === "revision-stale", `${turnedAway.status} ${turnedAway.json?.reason ?? ""}`);
    const next = data(await call("POST", "/api/identity/auth/refresh", { refreshToken: leilaSession.refreshToken }));
    check("her refresh token still works (no sign-out)", Boolean(next?.accessToken));
    check("and carries HR's permissions", (await call("GET", "/api/identity/core-access/roles", null, next.accessToken)).status === 200);
  } finally {
    check("HR's holders restored", (await saveHolders(amira, await hrRole(amira), chosen)) === 200);
  }

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
