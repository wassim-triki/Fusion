// Takes test leftovers out of Carthage through the product API, as Amira Khelifi, the administrator:
// - Leila Baccouche, an employee, leaves the HR partner role (journey-b109 chose her), so she isn't offered Settings.
// - Mouna Kooli, Recruitment Partner, becomes administrator and HR in place of the Sidebar Admin test account.
// Safe to run twice. Run: node .local-docs/agents/data/tidy-carthage-roles.cjs   (stack up; FUSION_LOCAL_PASSWORD set)
const { BASE, PASSWORD, call, login } = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");

const data = (response, what) => {
  if (response.status >= 300) throw new Error(`${what}: ${response.status} ${JSON.stringify(response.json).slice(0, 300)}`);
  return response.json?.data;
};

async function saveChosen(token, roleName, change) {
  const roles = data(await call("GET", "/api/identity/core-access/roles", null, token), "roles");
  const id = (roles.roles ?? roles).find((role) => role.name === roleName).id;
  const { role, holders } = data(await call("GET", `/api/identity/core-access/roles/${id}`, null, token), roleName);
  const before = holders.filter((holder) => holder.isChosen).map((holder) => holder.userId);
  const after = change(before);
  if (after.length === before.length && after.every((userId) => before.includes(userId))) return console.log(`${roleName}: already right`);
  const response = await fetch(`${BASE}/api/identity/core-access/roles/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "If-Match": `"${role.version}"` },
    body: JSON.stringify({
      name: role.name,
      description: role.description,
      cells: role.cells,
      holderKind: role.holderKind,
      conditions: role.conditions,
      chosenUserIds: after,
    }),
  });
  if (!response.ok) throw new Error(`${roleName}: ${response.status} ${(await response.text()).slice(0, 300)}`);
  console.log(`${roleName}: saved, ${after.length} chosen`);
}

(async () => {
  const amira = await login("amira.khelifi@example.test");
  const LEILA = "leila.baccouche@example.test";
  const partner = data(await call("GET", "/api/identity/core-access/roles", null, amira), "roles");
  const partnerId = (partner.roles ?? partner).find((role) => role.name === "HR partner").id;
  const partnerHolders = data(await call("GET", `/api/identity/core-access/roles/${partnerId}`, null, amira), "HR partner").holders;
  const leilaId = partnerHolders.find((holder) => holder.email === LEILA)?.userId;
  await saveChosen(amira, "HR partner", (chosen) => chosen.filter((userId) => userId !== leilaId));

  let admins = data(await call("GET", "/api/identity/tenant-access/administrators", null, amira), "administrators");
  const candidates = data(await call("GET", "/api/identity/tenant-access/administrators/candidates", null, amira), "candidates");
  const mouna = candidates.find((person) => person.name === "Mouna Kooli");
  if (mouna) {
    data(await call("POST", "/api/identity/tenant-access/administrators", { userId: mouna.userId, password: PASSWORD }, amira), "add Mouna");
    console.log("Mouna Kooli: administrator");
  }
  const sidebar = admins.find((admin) => admin.name === "Sidebar Admin");
  if (sidebar) {
    const response = await fetch(`${BASE}/api/identity/tenant-access/administrators/${sidebar.membershipId}/authority:revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${amira}`, "If-Match": `"${sidebar.version}"` },
      body: JSON.stringify({ reason: "Test account replaced by a real person" }),
    });
    if (!response.ok) throw new Error(`remove Sidebar Admin: ${response.status} ${(await response.text()).slice(0, 300)}`);
    console.log("Sidebar Admin: no longer an administrator");
  }

  const fresh = await login("amira.khelifi@example.test");
  const hr = data(await call("GET", "/api/identity/core-access/roles", null, fresh), "roles");
  const hrId = (hr.roles ?? hr).find((role) => role.name === "HR").id;
  const hrHolders = data(await call("GET", `/api/identity/core-access/roles/${hrId}`, null, fresh), "HR").holders;
  const sidebarUser = hrHolders.find((holder) => holder.name === "Sidebar Admin")?.userId;
  const mounaUser = mouna?.userId ?? hrHolders.find((holder) => holder.name === "Mouna Kooli")?.userId;
  await saveChosen(fresh, "HR", (chosen) => [...new Set([...chosen.filter((userId) => userId !== sidebarUser), mounaUser].filter(Boolean))]);

  admins = data(await call("GET", "/api/identity/tenant-access/administrators", null, fresh), "administrators");
  console.log("administrators now:", admins.map((admin) => admin.name).join(", "));
  const leila = await login(LEILA);
  const sections = await call("GET", "/api/corehr/settings/sections", null, leila);
  console.log("Leila's Core HR settings sections:", (sections.json?.data ?? []).map((section) => section.id).join(", ") || "none");
  const asks = await call("GET", "/api/identity/tenant-context/administrators", null, leila);
  console.log("a refused page names:", asks.json.data.administrators.map((person) => person.name).join(", "));
})().catch((error) => { console.error(String(error).slice(0, 500)); process.exit(1); });
