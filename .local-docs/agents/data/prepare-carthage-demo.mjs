import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { BASE, MAILPIT, PASSWORD, call, login } = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");
const here = path.dirname(fileURLToPath(import.meta.url));
const statePath = path.join(here, "carthage-demo.local.json");
const data = await readState();

function unpack(response, label) {
  if (response.status >= 400) throw new Error(`${label} failed (${response.status}): ${JSON.stringify(response.json).slice(0, 1200)}`);
  return response.json?.data ?? response.json;
}

async function api(token, method, route, body) {
  return unpack(await call(method, route, body, token), `${method} ${route}`);
}

async function saveState() {
  await fs.writeFile(statePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function readState() {
  try { return JSON.parse(await fs.readFile(statePath, "utf8")); }
  // The foundation must exist before the FY2027 Cycle starts (2026-10-01): Performance reads Core HR as of the
  // Cycle start, so units dated later make team scope resolve to nothing (B-074).
  catch { return { company: "Carthage Digital Group", asOf: "2026-09-01", steps: {} }; }
}

const peopleNames = [
  ["Sami", "Ben Youssef"], ["Amira", "Khelifi"], ["Youssef", "Trabelsi"], ["Nour", "Ben Ali"], ["Mariam", "Gharbi"],
  ["Omar", "Mansour"], ["Ines", "Chaabane"], ["Karim", "Jaziri"], ["Rania", "Bouzid"], ["Mehdi", "Kacem"],
  ["Salma", "Haddad"], ["Fares", "Lachheb"], ["Yasmine", "Saidi"], ["Walid", "Dridi"], ["Hela", "Ben Amor"],
  ["Tarek", "Ayari"], ["Dorra", "Mabrouk"], ["Anis", "Khalfallah"], ["Sana", "Ben Salem"], ["Nabil", "Jlassi"],
  ["Leila", "Baccouche"], ["Khaled", "Sassi"], ["Rim", "Mahjoub"], ["Amine", "Hamdi"], ["Mouna", "Kooli"],
  ["Hichem", "Ben Romdhane"], ["Aicha", "Bouazizi"], ["Zied", "Saad"], ["Sarra", "Ben Fredj"], ["Bilel", "Chatti"],
  ["Lina", "Rekik"], ["Fethi", "Guesmi"], ["Eya", "Karray"], ["Adel", "Brahim"], ["Maha", "Ben Mabrouk"],
  ["Nizar", "Khemiri"], ["Dorsaf", "Belaid"], ["Rami", "Mami"], ["Syrine", "Belhaj"], ["Moncef", "Gharsalli"],
  ["Amina", "Ben Othman"], ["Chokri", "Bousnina"], ["Nesrine", "Masmoudi"], ["Houssem", "Dhaouadi"], ["Asma", "Ferchichi"],
  ["Sofiene", "Jebali"], ["Mariem", "Oueslati"], ["Aymen", "Karray"], ["Chaima", "Zribi"], ["Lotfi", "Bouhlel"],
  ["Racha", "Ben Chikha"], ["Mohamed", "Khalil"], ["Oumaima", "Sellami"], ["Seif", "Ben Aissa"], ["Wafa", "Mhenni"],
  ["Yassine", "Kammoun"], ["Emna", "Chaker"], ["Bassem", "Ghozzi"], ["Sabrine", "Daly"], ["Hatem", "Toumi"],
  ["Faten", "Kefi"], ["Ala", "Bouzgarrou"], ["Rania", "Sahli"], ["Moez", "Najar"], ["Meriem", "Hamrouni"],
  ["Kais", "Zouari"], ["Noura", "Baccar"], ["Ismail", "Ben Amor"], ["Rihab", "Chaouachi"], ["Taha", "Ben Rejeb"],
  ["Dhia", "Gharbi"], ["Sonia", "Bchir"], ["Oussama", "Ben Hmida"], ["Ghofrane", "Jendoubi"], ["Atef", "Ben Jannet"],
  ["Hanen", "Mnasri"], ["Farah", "Bouras"], ["Wassim", "Khalfa"], ["Rim", "Bouaziz"], ["Khalil", "Smaoui"],
  ["Dalia", "Mami"], ["Elyes", "Jaziri"], ["Marwa", "Hajri"], ["Salah", "Ben Hassine"], ["Sana", "Mokni"],
  ["Rafik", "Sahbi"], ["Amani", "Boukhris"], ["Noureddine", "Boussetta"], ["Hiba", "Messaoudi"], ["Anouar", "Ben Hassen"],
  ["Melek", "Khouaja"], ["Imed", "Saadaoui"], ["Sonia", "Jaziri"], ["Nadim", "Karray"], ["Olfa", "Mansour"],
  ["Maher", "Sassi"], ["Rania", "Gharbi"], ["Sami", "Bouzid"], ["Nadia", "Kefi"], ["Aymen", "Ben Salem"],
  ["Omar", "Trabelsi"], ["Mouna", "Baccouche"], ["Yasmine", "Dridi"], ["Fares", "Chaabane"],
];

function slug(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
}

function buildOrganization() {
  const rows = [];
  const add = (code, name, type, parent = "") => rows.push(["", code, name, type, parent]);
  add("CDG", "Carthage Digital Group", "Organization");
  const businessUnits = [
    { code: "TECH", name: "Product & Engineering", divisions: ["Product", "Engineering"] },
    { code: "CLIENT", name: "Client Solutions", divisions: ["Consulting", "Delivery"] },
    { code: "CORP", name: "Corporate Services", divisions: ["Finance & Operations", "People & Growth"] },
  ];
  const units = [];
  let departmentCount = 0;
  for (const bu of businessUnits) {
    const buCode = `CDG-${bu.code}`;
    add(buCode, bu.name, "Business Unit", "CDG");
    for (const [divisionIndex, division] of bu.divisions.entries()) {
      const divCode = `${buCode}-${divisionIndex + 1}`;
      add(divCode, division, "Division", buCode);
      for (let deptIndex = 1; deptIndex <= 2; deptIndex++) {
        const deptCode = `${divCode}-D${deptIndex}`;
        const department = `${division} ${deptIndex === 1 ? "A" : "B"}`;
        add(deptCode, department, "Department", divCode);
        const teamCount = departmentCount < 6 ? 2 : 1;
        departmentCount++;
        for (let teamIndex = 1; teamIndex <= teamCount; teamIndex++) {
          const teamCode = `${deptCode}-T${teamIndex}`;
          const teamName = `${department} ${teamIndex === 1 ? "Core" : "Platform"}`;
          add(teamCode, teamName, "Team", deptCode);
          units.push({ code: teamCode, name: teamName, bu: bu.code, division, department });
        }
      }
    }
  }
  if (rows.length !== 40 || units.length !== 18) throw new Error(`Unexpected org size: ${rows.length} rows, ${units.length} teams`);
  return { rows, units };
}

function buildPeople(units) {
  const roles = [
    ["Chief Executive Officer", "CDG-CORP-2-D2-T1"],
    ["Chief Technology Officer", "CDG-TECH-2-D2-T1"],
    ["Chief Client Officer", "CDG-CLIENT-2-D2-T1"],
    ["Chief People and Operations Officer", "CDG-CORP-2-D2-T1"],
    ["VP, Product", "CDG-TECH-1-D1-T1"], ["VP, Engineering", "CDG-TECH-2-D1-T1"],
    ["VP, Consulting", "CDG-CLIENT-1-D1-T1"], ["VP, Delivery", "CDG-CLIENT-2-D1-T1"],
    ["VP, Finance and Operations", "CDG-CORP-1-D1-T1"], ["VP, People and Growth", "CDG-CORP-2-D1-T1"],
    ["Engineering Manager", "CDG-TECH-2-D2-T1"], ["Product Manager", "CDG-TECH-1-D2-T1"],
    ["Cloud Platform Manager", "CDG-TECH-2-D1-T2"], ["Data and AI Manager", "CDG-TECH-2-D2-T2"],
    ["Cybersecurity Manager", "CDG-TECH-2-D1-T1"], ["UX Design Manager", "CDG-TECH-1-D1-T2"],
    ["Consulting Manager", "CDG-CLIENT-1-D1-T2"], ["Delivery Manager", "CDG-CLIENT-2-D1-T2"],
    ["Finance Manager", "CDG-CORP-1-D1-T1"], ["People Operations Manager", "CDG-CORP-2-D1-T1"],
  ];
  const locations = ["Tunis", "Ariana", "Sfax", "Sousse", "Monastir", "Nabeul", "Remote - Tunisia"];
  const titles = [
    "Senior Software Engineer", "Software Engineer", "Frontend Engineer", "Backend Engineer", "Mobile Engineer",
    "Site Reliability Engineer", "Cloud Engineer", "Data Engineer", "Machine Learning Engineer", "Security Analyst",
    "QA Automation Engineer", "Product Designer", "Product Analyst", "Business Analyst", "Technology Consultant",
    "Senior Consultant", "Implementation Consultant", "Solution Architect", "Project Manager", "Customer Success Manager",
    "Finance Analyst", "Recruitment Partner", "People Operations Specialist", "Marketing Manager", "Operations Analyst",
  ];
  const managerIndexes = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  const teamIndexFor = (i) => i % units.length;
  return peopleNames.slice(0, 100).map(([first, last], i) => {
    const employeeIndex = i + 1;
    let title = titles[(i * 7 + 3) % titles.length];
    if (employeeIndex <= roles.length) title = roles[employeeIndex - 1][0];
    const unit = units[teamIndexFor(i)];
    let managerIndex = null;
    if (employeeIndex === 1) managerIndex = null;
    else if (employeeIndex >= 2 && employeeIndex <= 4) managerIndex = 1;
    else if (employeeIndex === 5 || employeeIndex === 6) managerIndex = 2;
    else if (employeeIndex === 7 || employeeIndex === 8) managerIndex = 3;
    else if (employeeIndex === 9 || employeeIndex === 10) managerIndex = 4;
    else if (employeeIndex >= 11 && employeeIndex <= 20) managerIndex = [6, 5, 6, 6, 6, 5, 7, 8, 9, 10][employeeIndex - 11];
    else {
      const candidates = managerIndexes.filter((manager) => manager !== 1);
      managerIndex = candidates[(i * 11 + 2) % candidates.length];
    }
    const email = `${slug(first)}.${slug(last)}@example.test`;
    return {
      employeeNumber: `CDG-${String(employeeIndex).padStart(3, "0")}`,
      firstName: first,
      lastName: last,
      email,
      startDate: employeeIndex === 1 ? "2018-05-07" : `202${(employeeIndex % 5)}-${String((employeeIndex % 12) + 1).padStart(2, "0")}-${String((employeeIndex % 26) + 1).padStart(2, "0")}`,
      organization: unit.code,
      title,
      location: locations[(i * 3) % locations.length],
      workerReference: `CDG-W${String(employeeIndex).padStart(3, "0")}`,
      managerIndex,
      managerReference: managerIndex === null ? "" : `CDG-W${String(managerIndex).padStart(3, "0")}`,
      lifecycle: "Active",
    };
  });
}

function workforceCells(people) {
  return people.map((person) => [person.employeeNumber, person.firstName, person.lastName, "", person.email,
    person.startDate, "", person.organization, person.title, person.location, "", person.workerReference,
    person.managerReference, person.lifecycle, "", "", "", ""]);
}

function ensure(condition, message) { if (!condition) throw new Error(message); }

async function expect(token, method, route, body, label = route) {
  return api(token, method, route, body).catch((error) => { throw new Error(`${label}: ${error.message}`); });
}

async function versioned(token, method, route, version, body) {
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "If-Match": `"${version}"` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (response.status >= 400) throw new Error(`${method} ${route} failed (${response.status}): ${JSON.stringify(json).slice(0, 1600)}`);
  return json?.data ?? json;
}

async function main() {
  const platformToken = await login("admin@ey-hr.com");
  const tenantsResponse = await api(platformToken, "GET", "/api/identity/platform-admin/tenants?page=1&pageSize=100");
  const existing = (tenantsResponse.items ?? tenantsResponse.tenants ?? []).find((tenant) => tenant.name === data.company);
  if (!data.tenantId) {
    if (existing) data.tenantId = existing.id ?? existing.tenantId;
    else {
      const provisioned = await expect(platformToken, "POST", "/api/identity/platform-admin/tenants", {
        name: data.company, locale: "en-US", timeZone: "Africa/Tunis", industry: "Technology",
        modules: ["Performance"], administratorEmail: "amira.khelifi@example.test",
        administratorFirstName: "Amira", administratorLastName: "Khelifi",
        idempotencyKey: "carthage-digital-group-fy2027-demo-v1",
      }, "Provision Carthage Digital Group");
      data.tenantId = provisioned.tenantId ?? provisioned.id;
      data.bootstrapInvitationId = provisioned.bootstrapInvitationId ?? null;
    }
    ensure(data.tenantId, "Tenant provisioning returned no tenant ID.");
    await saveState();
  }

  let tenantAdminToken;
  try { tenantAdminToken = await login("amira.khelifi@example.test"); }
  catch {
    const messages = await (await fetch(`${MAILPIT}/api/v1/search?query=to:${encodeURIComponent("amira.khelifi@example.test")}`)).json();
    const message = messages.messages?.[0];
    ensure(message, "Bootstrap invitation not found in local Mailpit.");
    const fullMessage = await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json();
    const body = `${fullMessage.Text ?? ""}\n${fullMessage.HTML ?? ""}`;
    const rawCredential = body.match(/[?&]credential=([^&"'<>\s]+)/)?.[1];
    ensure(rawCredential, "Could not read the bootstrap invitation credential from local Mailpit.");
    const credential = decodeURIComponent(rawCredential.replace(/&amp;/g, "&"));
    const activated = await fetch(`${BASE}/api/identity/tenant-activation`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential, password: PASSWORD, firstName: "Amira", lastName: "Khelifi" }),
    });
    const activatedBody = await activated.json();
    ensure(activated.ok, `Bootstrap activation failed (${activated.status}): ${JSON.stringify(activatedBody).slice(0, 700)}`);
    tenantAdminToken = activatedBody?.data?.accessToken ?? activatedBody?.data?.token;
    ensure(tenantAdminToken, "Bootstrap activation did not return a tenant session.");
    data.steps.bootstrapActivated = true;
    await saveState();
  }

  const { rows: orgRows, units } = buildOrganization();
  const people = buildPeople(units);
  ensure(people.length === 100, "Roster must contain exactly 100 employees.");
  ensure(new Set(people.map((person) => person.email)).size === 100, "Roster email addresses are not unique.");
  ensure(new Set(people.map((person) => person.managerReference).filter(Boolean)).size > 0, "Roster is missing manager references.");
  data.roster = people;
  data.orgUnits = orgRows;
  data.personas = [
    { workerReference: "CDG-W002", email: people[1].email, access: "Tenant Administrator and Manager" },
    { workerReference: "CDG-W005", email: people[4].email, access: "Manager and reviewer" },
    { workerReference: "CDG-W006", email: people[5].email, access: "Manager and reviewer; no team-view grant" },
    { workerReference: "CDG-W021", email: people[20].email, access: "Employee subject" },
    { workerReference: "CDG-W022", email: people[21].email, access: "Employee subject" },
    { workerReference: "CDG-W023", email: people[22].email, access: "Employee subject" },
  ];
  await saveState();

  // B-186: the two files as CSV in the headers Fusion has always written, brought in through one import.
  const csv = (rows) => rows.map((cells) => cells.map((cell) => {
    const text = String(cell ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(",")).join("\n");
  const workforceHeaders = ["Employee Number", "First Name", "Last Name", "Preferred Name", "Work Email", "Employment Start",
    "Work Details Effective From", "Organization", "Display Title", "Location", "Manager", "Worker Reference", "Manager Reference",
    "Lifecycle Status", "Employment End", "Fusion Employee Reference", "Fusion Organization Reference", "Fusion Manager Reference"];
  const orgPath = path.join(here, "carthage-organization.csv");
  await fs.writeFile(orgPath, csv([["Fusion OrgUnit ID", "Business Code", "Name", "Type", "Parent Business Code"], ...orgRows]));
  const workforcePath = path.join(here, "carthage-workforce.csv");
  await fs.writeFile(workforcePath, csv([workforceHeaders, ...workforceCells(people)]));
  data.workbooks = { organization: orgPath, workforce: workforcePath, workforceHeaders };
  data.steps.workbooksGenerated = true;
  await saveState();

  if (!data.steps.companyBroughtIn) {
    let session = data.companyImportSessionId ? await api(tenantAdminToken, "GET", `/api/corehr/imports/${data.companyImportSessionId}`) : null;
    if (!session) {
      const form = new FormData();
      for (const file of [orgPath, workforcePath]) form.append("files", new Blob([await fs.readFile(file)], { type: "text/csv" }), path.basename(file));
      form.append("companyName", "Carthage Digital Group");
      const response = await fetch(`${BASE}/api/corehr/imports`, { method: "POST", headers: { Authorization: `Bearer ${tenantAdminToken}` }, body: form });
      const body = await response.json().catch(() => null);
      ensure(response.ok, `The import didn't start: ${response.status} ${JSON.stringify(body).slice(0, 800)}`);
      session = body.data;
      data.companyImportSessionId = session.id;
      await saveState();
    }
    if (session.status === "Open") {
      if (session.openCount > 0) session = await versioned(tenantAdminToken, "POST", `/api/corehr/imports/${session.id}/leans`, session.version, {});
      ensure(session.canBringIn, `The import needs a look: ${JSON.stringify(session.checks.filter((check) => !check.answer)).slice(0, 1600)}`);
      session = await versioned(tenantAdminToken, "POST", `/api/corehr/imports/${session.id}/bring-in`, session.version, { fingerprint: session.fingerprint });
    }
    for (let attempt = 0; session.status !== "BroughtIn"; attempt++) {
      ensure(session.status === "BringingIn" && attempt < 120, `Bring-in did not complete: ${session.lastFailure ?? session.status}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      session = await api(tenantAdminToken, "GET", `/api/corehr/imports/${session.id}`);
    }
    data.steps.companyBroughtIn = true;
    await saveState();
  }

  const accessPage = await api(tenantAdminToken, "GET", "/api/corehr/workforce/access-subjects?page=1&pageSize=200");
  const subjects = accessPage.items ?? [];
  ensure(subjects.length === 100, `Expected 100 workforce access subjects, found ${subjects.length}.`);
  data.employeeIds = Object.fromEntries(subjects.map((subject) => [subject.employeeNumber, subject.employeeId]));
  await saveState();

  if (!data.steps.adminLinkedToWorkforce) {
    const adminEmployeeId = data.employeeIds["CDG-002"];
    const candidate = await api(tenantAdminToken, "GET", `/api/corehr/workforce/access-subjects/${adminEmployeeId}/candidate`);
    if (candidate.accountState !== "Active") {
      const routeAction = candidate.availableActions?.includes("Link") ? "link" : candidate.availableActions?.includes("Connect") ? "connect" : null;
      ensure(routeAction, `Tenant administrator could not be linked to the workforce person: ${JSON.stringify(candidate).slice(0, 1400)}`);
      const linked = await expect(tenantAdminToken, "POST", `/api/corehr/workforce/access-subjects/${adminEmployeeId}/${routeAction}`, {
        employeeId: adminEmployeeId, baseline: "Manager", expectedVersion: candidate.version,
      }, "Link tenant administrator to workforce");
      ensure(linked.outcome === "Ok", `Tenant administrator link did not succeed: ${JSON.stringify(linked)}`);
    }
    data.steps.adminLinkedToWorkforce = true;
    await saveState();
  }

  for (const persona of data.personas) {
    if (persona.workerReference === "CDG-W002") continue;
    if (persona.accountReady) continue;
    const employeeNumber = persona.workerReference.replace("CDG-W", "CDG-");
    const subject = subjects.find((item) => item.employeeNumber === employeeNumber);
    ensure(subject, `Persona employee ${employeeNumber} wasn't found in the access roster.`);
    try {
      await login(persona.email);
      persona.accountReady = true;
      persona.userId = (await api(tenantAdminToken, "GET", "/api/identity/core-access/assignments")).find((assignment) => assignment.email === persona.email)?.userId;
      await saveState();
    } catch {
      if (subject.accessState === "NotInvited" || subject.provisioningState === "Unprovisioned") {
        tenantAdminToken = await login("amira.khelifi@example.test");
        const baseline = persona.access.startsWith("Manager") ? "Manager" : "Employee";
        const activation = await expect(tenantAdminToken, "POST", `/api/corehr/workforce/access-subjects/${subject.employeeId}/activate`, {
          employeeId: subject.employeeId, baseline, expectedVersion: 0,
        }, `Invite ${persona.email}`);
        ensure(activation.outcome === "Ok", `Invite not created for ${persona.email}: ${JSON.stringify(activation)}`);
      }
      const invitation = await require("../../../.agents/skills/fusion-dev/scripts/api.cjs").inviteToken(persona.email);
      const accept = await fetch(`${BASE}/api/identity/invites/${encodeURIComponent(invitation.token)}/accept`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: subject.firstName, lastName: subject.lastName, password: PASSWORD }),
      });
      const accepted = await accept.json();
      ensure(accept.ok, `Workforce invitation acceptance failed for ${persona.email} (${accept.status}): ${JSON.stringify(accepted).slice(0, 900)}`);
      persona.userId = accepted?.data?.id ?? accepted?.data?.userId;
      await login(persona.email);
      persona.accountReady = true;
      await saveState();
    }
  }

  tenantAdminToken = await login("amira.khelifi@example.test");
  if (!data.steps.noTeamViewProfileCreated) {
    const profiles = await api(tenantAdminToken, "GET", "/api/identity/core-access/profiles");
    const manager = profiles.find((profile) => profile.name === "Manager");
    ensure(manager, "The tenant's seeded Manager profile is unavailable.");
    const profileName = "Manager reviewer without team view";
    let restricted = profiles.find((profile) => profile.name === profileName);
    if (!restricted) {
      restricted = await expect(tenantAdminToken, "POST", "/api/identity/core-access/profiles", {
        name: profileName,
        description: "Local demo reviewer access without team-view permission.",
        grants: manager.grants.filter((grant) => grant.permissionKey !== "core.team.view")
          .map((grant) => ({ permissionKey: grant.permissionKey, scope: grant.scope })),
      }, "Create restricted reviewer profile");
    }
    const assignments = await api(tenantAdminToken, "GET", "/api/identity/core-access/assignments");
    const restrictedPersona = data.personas.find((persona) => persona.workerReference === "CDG-W006");
    const userId = restrictedPersona.userId ?? assignments.find((assignment) => assignment.email === restrictedPersona.email)?.userId;
    ensure(userId, "Could not resolve the restricted reviewer account ID.");
    await expect(tenantAdminToken, "PUT", `/api/identity/core-access/assignments/${userId}`, { accessProfileIds: [restricted.id] }, "Assign restricted reviewer profile");
    data.steps.noTeamViewProfileCreated = true;
    data.restrictedReviewerProfileId = restricted.id;
    await saveState();
  }

  for (const persona of data.personas) {
    const token = await login(persona.email);
    const access = await api(token, "GET", "/api/identity/core-access/me");
    const assignments = await api(tenantAdminToken, "GET", "/api/identity/core-access/assignments");
    persona.userId = persona.userId ?? assignments.find((assignment) => assignment.email === persona.email)?.userId;
    persona.employeeId = data.employeeIds[persona.workerReference.replace("CDG-W", "CDG-")];
    persona.signInVerified = !!access.tenantId && !!persona.userId && !!persona.employeeId;
  }
  await saveState();

  tenantAdminToken = await login("amira.khelifi@example.test");
  const defaults = await api(tenantAdminToken, "GET", "/api/performance/settings");
  const ratingScale = await api(tenantAdminToken, "GET", "/api/performance/settings/rating-scale");
  ensure(defaults.suggestedObjectiveCountMin === 3 && defaults.suggestedObjectiveCountMax === 6
    && defaults.planningDeadlineOffsetDays === 30 && defaults.planAlignmentPolicy === "AtLeastOneConnected"
    && defaults.defaultSelfAssessmentEnabled && defaults.defaultObjectiveRatingsEnabled
    && !defaults.defaultCalibrationEnabled, "Performance defaults differ from the approved fixture assumptions.");
  ensure(ratingScale.levels?.length === 5, "The default five-level rating scale is not present.");
  data.performance ??= {};
  data.performance.defaults = defaults;
  data.performance.ratingScale = ratingScale;

  const competencies = [
    ["Systems Thinking", "Connects product, platform and service decisions to wider business outcomes.", ["Identifies dependencies", "Balances near-term delivery with long-term sustainability"]],
    ["Secure Engineering", "Builds and operates technology with security and privacy built in.", ["Applies secure-by-design practices", "Raises risks early and follows through on remediation"]],
    ["Customer Partnership", "Works with clients and colleagues to shape useful, dependable digital outcomes.", ["Listens for underlying needs", "Sets clear expectations and closes feedback loops"]],
    ["Data-Informed Decision Making", "Uses relevant evidence to prioritize work and evaluate results.", ["Chooses meaningful measures", "Explains trade-offs and revises decisions when evidence changes"]],
    ["Inclusive Collaboration", "Creates conditions for diverse teams to contribute and deliver well together.", ["Shares context openly", "Invites and incorporates different perspectives"]],
  ];
  let existingCompetencies = await api(tenantAdminToken, "GET", "/api/performance/settings/competencies");
  for (const [name, description, behaviors] of competencies) {
    if (existingCompetencies.some((item) => item.name === name)) continue;
    await expect(tenantAdminToken, "POST", "/api/performance/settings/competencies", { name, description, behaviors }, `Create competency ${name}`);
    existingCompetencies = await api(tenantAdminToken, "GET", "/api/performance/settings/competencies");
  }
  data.performance.competencies = existingCompetencies;
  data.steps.competenciesCreated = true;

  if (!data.performance.cycleId) {
    const cycle = await expect(tenantAdminToken, "POST", "/api/performance/cycles", {
      name: "FY2027 Cycle", startDate: "2026-10-01", endDate: "2027-09-30", planningDeadline: "2026-10-31",
      description: "Annual performance and growth cycle for Carthage Digital Group.",
    }, "Create FY2027 Cycle");
    data.performance.cycleId = cycle.id;
    data.performance.cycleName = cycle.name;
    await saveState();
  }
  const cycleId = data.performance.cycleId;
  let cycleDetail = await api(tenantAdminToken, "GET", `/api/performance/cycles/${cycleId}`);
  let cycleVersion = cycleDetail.cycle.version;

  const direction = [
    ["Build a resilient, secure cloud platform", "Improve platform resilience and secure delivery so teams can scale reliable digital products.", 99, "%"],
    ["Improve customer delivery predictability", "Increase delivery reliability and customer confidence across consulting and implementation work.", 90, "%"],
    ["Grow sustainable Tunisian digital capabilities", "Build the skills, collaboration and career pathways needed for lasting local technology growth.", 85, "%"],
  ];
  let strategicObjectives = await api(tenantAdminToken, "GET", `/api/performance/cycles/${cycleId}/strategy`);
  const adminEmployeeId = data.employeeIds["CDG-002"];
  for (const [title, description, target, unit] of direction) {
    let objective = strategicObjectives.find((item) => item.title === title);
    if (!objective) {
      objective = await expect(tenantAdminToken, "POST", `/api/performance/cycles/${cycleId}/strategy`, {
        title, description, accountablePersonId: adminEmployeeId,
        startDate: "2026-10-01", endDate: "2027-09-30", publish: true,
        expectedVersion: cycleVersion,
        measurement: { method: "NumericTarget", baseline: 0, target, unit, direction: "Increase", milestones: [] },
      }, `Create company objective ${title}`);
      strategicObjectives.push(objective);
      cycleDetail = await api(tenantAdminToken, "GET", `/api/performance/cycles/${cycleId}`);
      cycleVersion = cycleDetail.cycle.version;
    }
  }
  data.performance.strategicObjectives = strategicObjectives.filter((item) => direction.some(([title]) => title === item.title));
  ensure(data.performance.strategicObjectives.length === 3 && data.performance.strategicObjectives.every((item) => item.state === "Published"),
    "The three company objectives are not all published.");
  data.steps.companyObjectivesCreated = true;
  await saveState();

  if (!cycleDetail.populationConfirmed) {
    let population = await api(tenantAdminToken, "GET", `/api/performance/cycles/${cycleId}/population`);
    const ceoEmployeeId = data.employeeIds["CDG-001"];
    const exclusionReason = "Top executive role has no in-cycle reviewer.";
    const existingExclusion = population.selection.exclusions?.find((item) => item.employeeId === ceoEmployeeId);
    if (!existingExclusion) {
      population = await expect(tenantAdminToken, "PUT", `/api/performance/cycles/${cycleId}/population`, {
        mode: "AllActive", orgUnitSelections: [], inclusions: [],
        exclusions: [...(population.selection.exclusions ?? []), { employeeId: ceoEmployeeId, reason: exclusionReason }],
        expectedVersion: population.selection.version,
      }, "Set FY2027 population");
    }
    ensure(population.readyCount === 99 && population.needsAttentionCount === 0,
      `Cycle population is not ready at 99: ready=${population.readyCount}, attention=${population.needsAttentionCount}, excluded=${population.excludedCount}`);
    population = await expect(tenantAdminToken, "POST", `/api/performance/cycles/${cycleId}/population/confirm`, {
      expectedVersion: population.selection.version,
    }, "Confirm FY2027 population");
    ensure(population.selection.isConfirmed && population.readyCount === 99, "The FY2027 population did not confirm at 99 participants.");
    data.performance.population = population;
    await saveState();
    cycleDetail = await api(tenantAdminToken, "GET", `/api/performance/cycles/${cycleId}`);
  }

  if (cycleDetail.cycle.state !== "Active") {
    cycleDetail = await expect(tenantAdminToken, "POST", `/api/performance/cycles/${cycleId}/activate`, { expectedVersion: cycleDetail.cycle.version }, "Activate FY2027 Cycle");
  }
  ensure(cycleDetail.cycle.state === "Active" && cycleDetail.confirmedParticipantCount === 99,
    `Cycle is not Active with 99 confirmed participants: ${JSON.stringify(cycleDetail).slice(0, 1500)}`);
  data.performance.cycle = cycleDetail;
  data.steps.cycleActivated = true;
  await saveState();

  const alignedObjectiveId = data.performance.strategicObjectives[0].id;
  const planSubjects = [
    { employeeNumber: "CDG-005", status: "Approved", email: people[4].email },
    { employeeNumber: "CDG-006", status: "Submitted", email: people[5].email },
    { employeeNumber: "CDG-021", status: "Draft", email: people[20].email },
  ];
  data.performance.plans ??= {};
  for (const sample of planSubjects) {
    let employeeToken = await login(sample.email);
    let myPlan = await api(employeeToken, "GET", `/api/performance/cycles/${cycleId}/plan`);
    let plan = myPlan.plan;
    if (!myPlan.hasPlan) {
      plan = await expect(employeeToken, "POST", `/api/performance/cycles/${cycleId}/plan`, { expectedVersion: cycleDetail.cycle.version }, `Create plan for ${sample.employeeNumber}`);
      myPlan = { hasPlan: true, plan };
    }
    const objectives = [
      { title: "Deliver a reliable, secure product capability", description: "Ship a customer-valued capability with agreed reliability and security checks.", parentObjectiveId: alignedObjectiveId, planWeight: 40, target: 100, unit: "%" },
      { title: "Improve delivery flow and quality", description: "Reduce avoidable rework while keeping delivery commitments visible.", parentObjectiveId: null, planWeight: 35, target: 20, unit: "%" },
      { title: "Build role-relevant technical capability", description: "Complete a practical learning goal and share the resulting knowledge with the team.", parentObjectiveId: null, planWeight: 25, target: 2, unit: "milestones" },
    ];
    if (plan.objectives.length < 3) {
      for (const objective of objectives.slice(plan.objectives.length)) {
        const updated = await expect(employeeToken, "POST", `/api/performance/cycles/${cycleId}/plan/objectives`, {
          title: objective.title, description: objective.description, parentObjectiveId: objective.parentObjectiveId,
          startDate: "2026-10-01", endDate: "2027-09-30", planWeight: objective.planWeight,
          expectedVersion: plan.version,
          measurement: { method: "NumericTarget", baseline: 0, target: objective.target, unit: objective.unit, direction: "Increase", milestones: [] },
        }, `Add plan objective for ${sample.employeeNumber}`);
        plan = updated;
        data.performance.plans[sample.employeeNumber] = { planId: plan.id, state: plan.state, objectiveCount: plan.objectives.length };
        await saveState();
      }
    }
    ensure(plan.objectives.length === 3, `${sample.employeeNumber} does not have three objectives.`);
    if (sample.status !== "Draft" && plan.state === "Draft") {
      plan = await expect(employeeToken, "POST", `/api/performance/cycles/${cycleId}/plan/submit`, { expectedVersion: plan.version }, `Submit plan for ${sample.employeeNumber}`);
    }
    if (sample.status === "Approved" && plan.state === "Submitted") {
      tenantAdminToken = await login("amira.khelifi@example.test");
      plan = await expect(tenantAdminToken, "POST", `/api/performance/cycles/${cycleId}/plans/${plan.id}/approve`, { expectedVersion: plan.version }, "Approve manager's direct report plan");
    }
    ensure(plan.state === sample.status, `Plan for ${sample.employeeNumber} is ${plan.state}, expected ${sample.status}.`);
    data.performance.plans[sample.employeeNumber] = { planId: plan.id, state: plan.state, objectiveCount: plan.objectives.length };
    await saveState();
  }
  data.steps.samplePlansCreated = true;

  const peopleCheck = await api(tenantAdminToken, "GET", "/api/corehr/employees/people?page=1&pageSize=100");
  const hierarchyCheck = await api(tenantAdminToken, "GET", `/api/corehr/organization/hierarchy?asOf=${data.asOf}`);
  const countNodes = (nodes, counts = {}) => {
    for (const node of nodes) {
      counts[node.unit.typeName] = (counts[node.unit.typeName] ?? 0) + 1;
      countNodes(node.children ?? [], counts);
    }
    return counts;
  };
  const unitCounts = countNodes(hierarchyCheck.roots);
  ensure(peopleCheck.totalCount === 100 && peopleCheck.items.length === 100
    && peopleCheck.items.every((person) => person.employmentState === "Active"), "Final workforce verification failed.");
  ensure(JSON.stringify(unitCounts) === JSON.stringify({ Organization: 1, "Business Unit": 3, Division: 6, Department: 12, Team: 18 }),
    `Final organization type counts are wrong: ${JSON.stringify(unitCounts)}`);

  const finalCycle = await api(tenantAdminToken, "GET", `/api/performance/cycles/${cycleId}`);
  const finalPopulation = await api(tenantAdminToken, "GET", `/api/performance/cycles/${cycleId}/population`);
  const finalRounds = await api(tenantAdminToken, "GET", `/api/performance/cycles/${cycleId}/review-rounds`);
  const workspace = await api(tenantAdminToken, "GET", `/api/performance/context?cycleId=${cycleId}`);
  const assignments = await api(tenantAdminToken, "GET", "/api/identity/core-access/assignments");
  const planVerification = {};
  for (const sample of planSubjects) {
    const planRef = data.performance.plans[sample.employeeNumber];
    const plan = await api(tenantAdminToken, "GET", `/api/performance/cycles/${cycleId}/plans/${planRef.planId}`);
    ensure(plan.state === sample.status && plan.objectives.length === 3 && plan.readiness.weightTotal === 100
      && plan.objectives.filter((objective) => objective.isAligned).length >= 1,
      `Final plan verification failed for ${sample.employeeNumber}: ${JSON.stringify(plan.readiness)}`);
    planVerification[sample.employeeNumber] = { state: plan.state, objectiveCount: plan.objectives.length, weightTotal: plan.readiness.weightTotal, aligned: plan.objectives.filter((objective) => objective.isAligned).length };
  }
  const personaVerification = [];
  for (const persona of data.personas) {
    const assignment = assignments.find((item) => item.email === persona.email);
    ensure(assignment?.isActive && assignment.employeeId === persona.employeeId, `Persona account isn't active and linked: ${persona.email}`);
    const token = await login(persona.email);
    const userAccess = await api(token, "GET", "/api/identity/core-access/me");
    personaVerification.push({ email: persona.email, employeeNumber: persona.workerReference.replace("CDG-W", "CDG-"), profiles: assignment.accessProfiles.map((profile) => profile.name) });
    if (persona.workerReference === "CDG-W006") {
      ensure(userAccess.effectivePermissions.some((permission) => permission.permissionKey === "performance.cycle.view" && permission.scope === "DirectReports")
        && !userAccess.effectivePermissions.some((permission) => permission.permissionKey === "core.team.view"),
        "The restricted reviewer doesn't have the intended no-team-view permission boundary.");
    }
  }
  ensure(finalCycle.cycle.state === "Active" && finalCycle.cycle.startDate === "2026-10-01"
    && finalCycle.cycle.endDate === "2027-09-30" && finalCycle.cycle.planningDeadline === "2026-10-31"
    && finalCycle.confirmedParticipantCount === 99 && !finalCycle.otherActiveCycleExists,
    "Final Cycle verification failed.");
  ensure(finalPopulation.selection.isConfirmed && finalPopulation.readyCount === 99 && finalPopulation.needsAttentionCount === 0
    && finalPopulation.excludedCount === 1 && finalPopulation.selection.exclusions.some((entry) => entry.employeeId === data.employeeIds["CDG-001"]
      && entry.reason === "Top executive role has no in-cycle reviewer."), "Final Cycle population verification failed.");
  ensure(finalRounds.length === 0 && workspace.destinations.reviews && workspace.selected.id === cycleId
    && workspace.capabilities.administers,
    "Reviews workspace is not ready or a review round exists.");
  data.verification = {
    verifiedAt: new Date().toISOString(),
    employees: peopleCheck.totalCount,
    orgUnits: Object.values(unitCounts).reduce((sum, count) => sum + count, 0),
    orgUnitCountsByType: unitCounts,
    cycle: { name: finalCycle.cycle.name, state: finalCycle.cycle.state, planningDeadline: finalCycle.cycle.planningDeadline, participants: finalCycle.confirmedParticipantCount, otherActiveCycleExists: finalCycle.otherActiveCycleExists },
    reviewRounds: finalRounds.length,
    reviewsDestinationReady: workspace.destinations.reviews,
    plans: planVerification,
    personas: personaVerification,
  };
  data.steps.finalVerificationPassed = true;
  await saveState();
  console.log(JSON.stringify({
    tenantId: data.tenantId,
    rosterCount: people.length,
    organizationCount: orgRows.length,
    teamCount: units.length,
    orgPublished: data.steps.organizationPublished,
    workforcePublished: data.steps.workforcePublished,
    personaCount: data.personas.filter((persona) => persona.signInVerified).length,
    cycleState: data.performance.cycle.cycle.state,
    participantCount: data.performance.cycle.confirmedParticipantCount,
    planStates: data.performance.plans,
    verification: data.verification,
  }, null, 2));
}

main().catch((error) => { console.error(error.stack ?? error); process.exit(1); });
