// B-173 API journey, through the shell like the browser:
//   node .local-docs/agents/data/journey-b173-old-invites.cjs
// Can someone who holds HR but isn't an administrator make a tenant administrator through Identity's old invitation
// endpoint (`POST /api/identity/tenants/{id}/invites`, role "OrgAdmin")? In Carthage Digital Group, Amira (tenant
// administrator) adds Leila (employee) to the HR role for the run. Leila then creates an "OrgAdmin" invitation
// (create), reads it back (inspect, list), accepts one as a new person and checks whether that person became an
// administrator, and revokes a second one (revoke). Before B-178 retires the endpoint this records what it allowed;
// after, every call must be refused.
// Ran 2026-10-31 before retirement: create 201, list 200, read back 200 (role OrgAdmin), accept 404 ("not valid": the
// workforce acceptance needs a digest credential), revoke 200; GET /identity/users 200 (Learning keeps it); creating a
// user with OrgAdmin 400. So no administrator came of it, but a non-administrator could mint, list and revoke.
// Ran again after B-178 retired them: create, list, revoke and user creation 404; GET /identity/users still 200 (Learning). Restores HR's holders and deletes the probe account at the end.
const path = require("path");
const { call, login, PASSWORD } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const data = (r) => r.json?.data;
const claims = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
const roleClaim = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";
const rolesOf = (token) => [claims(token)[roleClaim] ?? []].flat();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = Date.now().toString(36);

function line(label, r) {
  const body = typeof r.json === "string" ? r.json : JSON.stringify(r.json?.errors ?? r.json?.message ?? r.json?.title ?? "");
  console.log(`${String(r.status).padEnd(4)} ${label}  ${body.slice(0, 160)}`);
}

async function hrRole(amira) {
  const overview = data(await call("GET", "/api/identity/core-access/roles", null, amira));
  const hr = overview.roles.find((role) => role.isBuiltIn && role.name === "HR");
  return data(await call("GET", `/api/identity/core-access/roles/${hr.id}`, null, amira));
}

async function saveHolders(amira, detail, chosenUserIds) {
  const role = detail.role;
  const r = await fetch("http://localhost:3000/api/identity/core-access/roles/" + role.id, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${amira}`, "If-Match": `"${role.version}"` },
    body: JSON.stringify({
      name: role.name, description: role.description, cells: role.cells, holderKind: role.holderKind,
      conditions: role.conditions, chosenUserIds,
    }),
  });
  return r.status;
}

(async () => {
  const amira = await login("amira.khelifi@example.test");
  const admin = await login("admin@ey-hr.com");
  const tenantId = claims(amira).tenant_id ?? claims(amira).tenantId;

  const before = await hrRole(amira);
  const chosenBefore = before.holders.filter((holder) => holder.isChosen).map((holder) => holder.userId);
  const leilaUser = data(await call("GET", "/api/identity/core-access/roles/candidates?search=Leila", null, amira))?.[0];
  console.log(`HR holders before: ${before.holders.map((holder) => holder.name).join(", ") || "none"}`);
  console.log(`save HR + Leila: ${await saveHolders(amira, before, [...new Set([...chosenBefore, leilaUser.userId])])}`);

  let leila;
  for (let i = 0; i < 20; i++) {
    leila = await login("leila.baccouche@example.test");
    if (rolesOf(leila).includes("HRAdmin")) break;
    await sleep(1500);
  }
  console.log(`Leila's token roles: ${rolesOf(leila).join(", ")}`);
  const leilaAdmins = await call("GET", "/api/identity/tenant-access/administrators", null, leila);
  line("Leila reads the administrators (not an administrator)", leilaAdmins);

  const probe = `b173.probe.${stamp}@example.test`;
  const second = `b173.second.${stamp}@example.test`;
  try {
    // create
    const created = await call("POST", `/api/identity/tenants/${tenantId}/invites`,
      { email: probe, role: "OrgAdmin", firstName: "Probe", lastName: "Admin" }, leila);
    line("create: Leila invites as OrgAdmin", created);
    const invite = data(created);

    // inspect
    const listed = await call("GET", `/api/identity/tenants/${tenantId}/invites`, null, leila);
    line("inspect: Leila lists the tenant's invitations", listed);
    if (invite?.token) {
      const read = await call("GET", `/api/identity/invites/${encodeURIComponent(invite.token)}`);
      line(`inspect: the invitation reads back (role ${data(read)?.role})`, read);

      const accepted = await call("POST", `/api/identity/invites/${encodeURIComponent(invite.token)}/accept`,
        { firstName: "Probe", lastName: "Admin", password: PASSWORD });
      line("accept: a new person accepts it", accepted);
      if (accepted.status < 300) {
        const probeToken = await login(probe).catch(() => null);
        console.log(`probe's token roles: ${probeToken ? rolesOf(probeToken).join(", ") || "none" : "can't sign in"}`);
        const admins = data(await call("GET", "/api/identity/tenant-access/administrators", null, amira)) ?? [];
        console.log(`probe is a tenant administrator: ${admins.some((item) => item.email === probe)}`);
      } else if (invite.id) {
        line("revoke: the refused invitation", await call("DELETE", `/api/identity/invites/${invite.id}`, null, leila));
      }
    }
    console.log(`verdict: the old endpoint ${created.status < 300 ? "still issues OrgAdmin invitations" : "is retired"}`);

    // revoke
    const other = await call("POST", `/api/identity/tenants/${tenantId}/invites`,
      { email: second, role: "OrgAdmin", firstName: "Second", lastName: "Probe" }, leila);
    line("create: a second OrgAdmin invitation", other);
    if (data(other)?.id) line("revoke: Leila revokes it", await call("DELETE", `/api/identity/invites/${data(other).id}`, null, leila));

    // the old user endpoints, for the record
    line("old users: Leila lists every user", await call("GET", "/api/identity/users", null, leila));
    line("old users: Leila creates a user", await call("POST", `/api/identity/tenants/${tenantId}/users`,
      { email: `b173.user.${stamp}@example.test`, password: PASSWORD, firstName: "Old", lastName: "User", role: "OrgAdmin" }, leila));
  } finally {
    const now = await hrRole(amira);
    console.log(`restore HR holders: ${await saveHolders(amira, now, chosenBefore)}`);
    for (const email of [probe, `b173.user.${stamp}@example.test`]) {
      const r = await call("DELETE", `/api/identity/dev/users/${encodeURIComponent(email)}`, null, admin);
      if (r.status !== 404) line(`clean up ${email}`, r);
    }
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
