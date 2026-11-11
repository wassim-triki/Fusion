// Accounts for everyone in a preset, through the product flows only: Core HR access activation sends the Identity
// invitation, the invitation is read from Mailpit and accepted with the local password. Managers get the Manager
// baseline; Omar Mansour keeps Carthage's reviewer profile without core.team.view.
import { PASSWORD, as, send, inviteToken } from "./client.mjs";

const ensure = (condition, message) => { if (!condition) throw new Error(message); };

async function activate(amira, person, baseline) {
  const activation = await amira.post(`/api/corehr/workforce/access-subjects/${person.employeeId}/activate`,
    { employeeId: person.employeeId, baseline, expectedVersion: 0 });
  ensure(activation.outcome === "Ok", `Activation of ${person.name}: ${JSON.stringify(activation)}`);
  const invitation = await inviteToken(person.email, 40);
  await send(null, "POST", `/api/identity/invites/${encodeURIComponent(invitation.token)}/accept`,
    { firstName: person.firstName, lastName: person.lastName, password: PASSWORD });
  await as(person.email).auth();
}

/** Activates every person but Amira (already the administrator), five at a time. */
export async function activateEveryone(people, log) {
  const amira = as(people[1].email);
  const managers = new Set(people.map((p) => p.managerIndex).filter(Boolean));
  const queue = people.filter((p) => p.index !== 2);
  let done = 0;
  const worker = async () => {
    for (let person = queue.shift(); person; person = queue.shift()) {
      await activate(amira, person, managers.has(person.index) ? "Manager" : "Employee");
      if (++done % 20 === 0) log(`${done} accounts activated`);
    }
  };
  await Promise.all(Array.from({ length: 5 }, worker));
  log(`${done + 1} accounts active (everyone, Amira included)`);

  // Omar reviews his team without the Core HR team view, as in Carthage. Custom access profiles went with the roles
  // model (POST now answers 405), so a build without them carries on and Omar keeps the team view (board: B-429).
  try {
    const profiles = await amira.get("/api/identity/core-access/profiles");
    const manager = profiles.find((profile) => profile.name === "Managers" || profile.name === "Manager");
    ensure(manager, "The tenant's Manager profile is missing.");
    const restricted = await amira.post("/api/identity/core-access/profiles", {
      name: "Manager reviewer without team view",
      description: "Local demo reviewer access without team-view permission.",
      grants: manager.grants.filter((g) => g.permissionKey !== "core.team.view").map((g) => ({ permissionKey: g.permissionKey, scope: g.scope })),
    });
    const omar = people.find((p) => p.employeeNumber === "CDG-006");
    const assignment = (await amira.get("/api/identity/core-access/assignments")).find((a) => a.email === omar.email);
    ensure(assignment?.userId, "Omar's account wasn't found among the assignments.");
    await amira.put(`/api/identity/core-access/assignments/${assignment.userId}`, { accessProfileIds: [restricted.id] });
    log("Omar reviews without core.team.view");
  } catch (error) {
    log(`Omar keeps the team view: ${String(error.message ?? error).split(/\r?\n/)[0]}`);
  }
}
