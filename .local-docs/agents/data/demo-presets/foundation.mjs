// The Carthage foundation for one preset tenant, through the platform and Core HR APIs: provision the tenant, activate
// Amira from the bootstrap invitation, import the 40-unit organization and the 100-person workforce dated `asOf`, and
// link Amira to her workforce record. Generalized from prepare-carthage-demo.mjs (which stays as it is for Carthage).
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";
import { BASE, MAILPIT, PASSWORD, as, send, sleep, Refused } from "./client.mjs";
import { groupJobs } from "./jobs.mjs";

export const PLATFORM_ADMIN = "admin@ey-hr.com";

const NAMES = [
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
];

const slug = (value) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
const ensure = (condition, message) => { if (!condition) throw new Error(message); };

export function emailFor(first, last, domain) {
  return `${slug(first)}.${slug(last)}@${domain}`;
}

function organization() {
  const rows = [];
  const add = (code, name, type, parent = "") => rows.push(["", code, name, type, parent]);
  add("CDG", "Carthage Digital Group", "Organization");
  const businessUnits = [
    { code: "TECH", name: "Product & Engineering", divisions: ["Product", "Engineering"] },
    { code: "CLIENT", name: "Client Solutions", divisions: ["Consulting", "Delivery"] },
    { code: "CORP", name: "Corporate Services", divisions: ["Finance & Operations", "People & Growth"] },
  ];
  const units = [];
  let departments = 0;
  for (const bu of businessUnits) {
    const buCode = `CDG-${bu.code}`;
    add(buCode, bu.name, "Business Unit", "CDG");
    for (const [divisionIndex, division] of bu.divisions.entries()) {
      const divCode = `${buCode}-${divisionIndex + 1}`;
      add(divCode, division, "Division", buCode);
      for (let d = 1; d <= 2; d++) {
        const deptCode = `${divCode}-D${d}`;
        const department = `${division} ${d === 1 ? "A" : "B"}`;
        add(deptCode, department, "Department", divCode);
        const teams = departments < 6 ? 2 : 1;
        departments++;
        for (let t = 1; t <= teams; t++) {
          const teamCode = `${deptCode}-T${t}`;
          add(teamCode, `${department} ${t === 1 ? "Core" : "Platform"}`, "Team", deptCode);
          units.push({ code: teamCode });
        }
      }
    }
  }
  ensure(rows.length === 40 && units.length === 18, `Unexpected org size: ${rows.length} rows, ${units.length} teams`);
  return { rows, units };
}

/** The Carthage roster (same people, titles, units and lines as prepare-carthage-demo.mjs), hired before `asOf`. */
export function roster(domain, asOf) {
  const { units } = organization();
  const roles = [
    "Chief Executive Officer", "Chief Technology Officer", "Chief Client Officer", "Chief People and Operations Officer",
    "VP, Product", "VP, Engineering", "VP, Consulting", "VP, Delivery", "VP, Finance and Operations", "VP, People and Growth",
    "Engineering Manager", "Product Manager", "Cloud Platform Manager", "Data and AI Manager", "Cybersecurity Manager",
    "UX Design Manager", "Consulting Manager", "Delivery Manager", "Finance Manager", "People Operations Manager",
  ];
  const locations = ["Tunis", "Ariana", "Sfax", "Sousse", "Monastir", "Nabeul", "Remote - Tunisia"];
  const titles = [
    "Senior Software Engineer", "Software Engineer", "Frontend Engineer", "Backend Engineer", "Mobile Engineer",
    "Site Reliability Engineer", "Cloud Engineer", "Data Engineer", "Machine Learning Engineer", "Security Analyst",
    "QA Automation Engineer", "Product Designer", "Product Analyst", "Business Analyst", "Technology Consultant",
    "Senior Consultant", "Implementation Consultant", "Solution Architect", "Project Manager", "Customer Success Manager",
    "Finance Analyst", "Recruitment Partner", "People Operations Specialist", "Marketing Manager", "Operations Analyst",
  ];
  const managerPool = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  const base = new Date(`${asOf}T00:00:00Z`);
  const hired = (index) => {
    if (index === 1) return new Date(Date.UTC(base.getUTCFullYear() - 8, 4, 7)).toISOString().slice(0, 10);
    const d = new Date(Date.UTC(base.getUTCFullYear() - 1 - (index % 5), base.getUTCMonth() - (index % 12), base.getUTCDate() - (index % 26)));
    return d.toISOString().slice(0, 10);
  };
  return NAMES.map(([first, last], i) => {
    const index = i + 1;
    let managerIndex = null;
    if (index >= 2 && index <= 4) managerIndex = 1;
    else if (index === 5 || index === 6) managerIndex = 2;
    else if (index === 7 || index === 8) managerIndex = 3;
    else if (index === 9 || index === 10) managerIndex = 4;
    else if (index >= 11 && index <= 20) managerIndex = [6, 5, 6, 6, 6, 5, 7, 8, 9, 10][index - 11];
    else if (index > 20) managerIndex = managerPool[(i * 11 + 2) % managerPool.length];
    return {
      index,
      employeeNumber: `CDG-${String(index).padStart(3, "0")}`,
      firstName: first,
      lastName: last,
      name: `${first} ${last}`,
      email: emailFor(first, last, domain),
      startDate: hired(index),
      organization: units[i % units.length].code,
      title: index <= roles.length ? roles[index - 1] : titles[(i * 7 + 3) % titles.length],
      location: locations[(i * 3) % locations.length],
      workerReference: `CDG-W${String(index).padStart(3, "0")}`,
      managerIndex,
      managerReference: managerIndex === null ? "" : `CDG-W${String(managerIndex).padStart(3, "0")}`,
    };
  });
}

async function upload(token, route, filePath, fields) {
  const form = new FormData();
  form.append("file", new Blob([await fs.readFile(filePath)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), path.basename(filePath));
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
  const response = await fetch(`${BASE}${route}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  const text = await response.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (response.status >= 400) throw new Refused("POST", route, response.status, json);
  return json?.data ?? json;
}

async function versioned(token, method, route, version, body) {
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "If-Match": `"${version}"` },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (response.status >= 400) throw new Refused(method, route, response.status, json);
  return json?.data ?? json;
}

async function workbook(token, templateRoute, templatePath, sheetName, range, cells, outputPath) {
  const template = await fetch(`${BASE}${templateRoute}`, { headers: { Authorization: `Bearer ${token}` } });
  ensure(template.ok, `Template download failed: ${templateRoute} ${template.status}`);
  await fs.writeFile(templatePath, Buffer.from(await template.arrayBuffer()));
  const book = await SpreadsheetFile.importXlsx(await FileBlob.load(templatePath));
  book.worksheets.getItem(sheetName).getRange(range).values = cells;
  book.recalculate();
  await (await SpreadsheetFile.exportXlsx(book)).save(outputPath);
}

/** Bootstrap activation from the invitation in Mailpit; returns nothing, Amira signs in with the local password after. */
async function activateBootstrap(email) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=to:${encodeURIComponent(email)}`)).json();
    const message = list.messages?.[0];
    if (message) {
      const full = await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json();
      const raw = `${full.Text ?? ""}\n${full.HTML ?? ""}`.match(/[?&]credential=([^&"'<>\s]+)/)?.[1];
      ensure(raw, `No bootstrap credential in the mail to ${email}.`);
      const credential = decodeURIComponent(raw.replace(/&amp;/g, "&"));
      await send(null, "POST", "/api/identity/tenant-activation", { credential, password: PASSWORD, firstName: "Amira", lastName: "Khelifi" });
      return;
    }
    await sleep(1000);
  }
  throw new Error(`No bootstrap invitation for ${email} in Mailpit.`);
}

/**
 * Builds the foundation and returns { tenantId, employees: { [employeeNumber]: employeeId }, people }.
 * `work` is a scratch folder for the generated workbooks; `log` prints progress. `people` defaults to the Carthage
 * roster; a larger one must keep it first (Amira is CDG-002).
 */
export async function buildFoundation({ name, domain, asOf, work, log, people = roster(domain, asOf) }) {
  const amiraEmail = people[1].email;
  await fs.mkdir(work, { recursive: true });

  const platform = as(PLATFORM_ADMIN);
  const provisioned = await platform.post("/api/identity/platform-admin/tenants", {
    name, locale: "en-US", timeZone: "Africa/Tunis", industry: "Technology", modules: ["Performance"],
    administratorEmail: amiraEmail, administratorFirstName: "Amira", administratorLastName: "Khelifi",
    idempotencyKey: `demo-preset-${slug(name)}-${crypto.randomUUID()}`,
  });
  const tenantId = provisioned.tenantId ?? provisioned.id;
  ensure(tenantId, "Provisioning returned no tenant id.");
  log(`tenant ${name} (${tenantId})`);

  await activateBootstrap(amiraEmail);
  const amira = as(amiraEmail);
  const token = await amira.auth();
  log("Amira activated as tenant administrator");

  const { rows } = organization();
  const orgPath = path.join(work, "organization.xlsx");
  await workbook(token, "/api/corehr/organization/imports/template", path.join(work, "organization-template.xlsx"),
    "Organization", `A2:E${rows.length + 1}`, rows, orgPath);
  const staffPath = path.join(work, "workforce.xlsx");
  await workbook(token, "/api/corehr/employees/import/template", path.join(work, "workforce-template.xlsx"),
    "Workforce", `A2:R${people.length + 1}`, people.map((p) => [p.employeeNumber, p.firstName, p.lastName, "", p.email,
      p.startDate, "", p.organization, p.title, p.location, "", p.workerReference, p.managerReference, "Active", "", "", "", ""]), staffPath);

  const orgIntake = await upload(token, "/api/corehr/organization/imports/intake", orgPath,
    { effectiveDate: asOf, creationToken: crypto.randomUUID(), selectedSheetName: "Organization" });
  const orgSession = await amira.get(`/api/corehr/organization/imports/${orgIntake.session.id}`);
  ensure(orgSession.match?.readiness?.canContinue, `Organization match needs review: ${JSON.stringify(orgSession.match?.readiness).slice(0, 800)}`);
  ensure(orgSession.review?.readiness?.canPublish, `Organization review is blocked: ${JSON.stringify(orgSession.review?.issues ?? []).slice(0, 800)}`);
  await versioned(token, "POST", `/api/corehr/organization/imports/${orgSession.id}/commit`, orgSession.version,
    { proposalFingerprint: orgSession.review.proposalFingerprint });
  log(`organization published as of ${asOf}`);

  const staffIntake = await upload(token, "/api/corehr/employees/import/intake", staffPath,
    { creationToken: crypto.randomUUID(), baselineDate: asOf, selectedSheet: "Workforce" });
  const sessionId = staffIntake.session.id;
  const staffSession = await amira.get(`/api/corehr/employees/import/${sessionId}`);
  ensure(staffSession.matchComplete && staffSession.canPublish, `Workforce import is blocked: ${JSON.stringify(staffSession.counts).slice(0, 800)}`);
  await versioned(token, "POST", `/api/corehr/employees/import/${sessionId}/commit`, staffSession.version,
    { proposalFingerprint: staffSession.proposalFingerprint });
  for (let attempt = 0; ; attempt++) {
    const status = await amira.get(`/api/corehr/employees/import/${sessionId}/commit`);
    if (["Committed", "Completed", "Applied", "Succeeded"].includes(status.status)) break;
    if (["Failed", "ReviewOutdated"].includes(status.status) || attempt > 60 + people.length / 10) throw new Error(`Workforce publication: ${JSON.stringify(status).slice(0, 800)}`);
    await sleep(1000);
  }
  log(`workforce published (${people.length} people)`);
  await groupJobs(amira, log);

  const subjects = [];
  for (let page = 1; ; page++) {
    const items = (await amira.get(`/api/corehr/workforce/access-subjects?page=${page}&pageSize=200`)).items ?? [];
    subjects.push(...items);
    if (!items.length) break;
  }
  ensure(subjects.length === people.length, `Expected ${people.length} access subjects, found ${subjects.length}.`);
  const employees = Object.fromEntries(subjects.map((s) => [s.employeeNumber, s.employeeId]));
  for (const person of people) person.employeeId = employees[person.employeeNumber];

  const candidate = await amira.get(`/api/corehr/workforce/access-subjects/${employees["CDG-002"]}/candidate`);
  if (candidate.accountState !== "Active") {
    const action = candidate.availableActions?.includes("Link") ? "link" : "connect";
    const linked = await amira.post(`/api/corehr/workforce/access-subjects/${employees["CDG-002"]}/${action}`,
      { employeeId: employees["CDG-002"], baseline: "Manager", expectedVersion: candidate.version });
    ensure(linked.outcome === "Ok", `Amira's link failed: ${JSON.stringify(linked)}`);
  }
  log("Amira linked to her workforce record");
  return { tenantId, people };
}
