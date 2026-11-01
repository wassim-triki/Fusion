// B-184 demo data, through the shell like the browser:
//   node .local-docs/agents/data/seed-b184-joining-leaving.cjs
// In Carthage Digital Group, as Amira (HR): the company's joining and leaving checklists; Yasmine Trabelsi hired into
// Mariam Gharbi's team, starting in 3 days, so her checklist, Mariam's Needs you and Yasmine's first week exist (HR's
// first task ticked); Aicha Bouazizi's birthday 9 days ahead, shared by Aicha, so her team sees it in Coming up.
// Re-runnable: templates are rewritten to the same tasks, the hire and the birthday are made once.
const path = require("path");
const { call, login } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const BASE = "http://localhost:3000";
const data = (r) => r.json?.data;
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const JOINING = [
  { title: "Prepare the contract and send it for signature", owner: "hr", offsetDays: -10 },
  { title: "Order a laptop and a badge", owner: "hr", offsetDays: -7 },
  { title: "Plan the first week and book a welcome lunch", owner: "manager", offsetDays: -3 },
  { title: "Choose a buddy in the team", owner: "manager", offsetDays: -2 },
  { title: "Add your photo and a few lines about you", owner: "person", offsetDays: 0 },
  { title: "Meet your buddy", owner: "person", offsetDays: 1 },
  { title: "Set your first goals with your manager", owner: "manager", offsetDays: 5 },
  { title: "Collect the signed contract", owner: "hr", offsetDays: 5 },
];
const LEAVING = [
  { title: "Agree the handover plan", owner: "manager", offsetDays: -14 },
  { title: "Hand over your work and documents", owner: "person", offsetDays: -3 },
  { title: "Book the exit conversation", owner: "hr", offsetDays: -5 },
  { title: "Return the laptop and badge", owner: "person", offsetDays: 0 },
  { title: "Close accounts and final pay", owner: "hr", offsetDays: 0 },
];

async function seed() {
  const amira = await login("amira.khelifi@example.test");
  const aicha = await login("aicha.bouazizi@example.test");
  for (const [kind, tasks] of [["joining", JOINING], ["leaving", LEAVING]]) {
    const saved = await call("PUT", `/api/corehr/checklists/templates/${kind}`, { tasks }, amira);
    if (saved.status !== 200) throw new Error(`${kind} template: ${saved.status} ${JSON.stringify(saved.json)}`);
  }
  console.log("templates written");

  const mariam = data(await call("GET", "/api/corehr/workforce/me", null, await login("mariam.gharbi@example.test"))).employee;
  const upcoming = data(await call("GET", "/api/corehr/employees/people/changes/upcoming", null, amira)) ?? [];
  let yasmine = upcoming.find((change) => change.person.displayName === "Yasmine Trabelsi")?.person;
  if (!yasmine) {
    const jobs = data(await call("GET", "/api/corehr/catalog/jobs", null, amira)) ?? [];
    const job = jobs.find((item) => item.title === "Product Manager" && !item.isRetired) ?? jobs.find((item) => !item.isRetired && item.peopleCount > 0);
    const hire = await call("POST", "/api/corehr/employees/hire", {
      firstName: "Yasmine", lastName: "Trabelsi", workEmail: "yasmine.trabelsi@example.test", employeeNumberMode: "Generated",
      startDate: `${day(3)}T00:00:00Z`, orgUnitId: mariam.orgUnit.orgUnitId, jobId: job.id, primaryManagerEmployeeId: mariam.employeeId,
    }, amira);
    if (hire.status !== 201) throw new Error(`hire: ${hire.status} ${JSON.stringify(hire.json)}`);
    yasmine = { employeeKey: data(hire).employeeKey };
    console.log(`hired Yasmine Trabelsi (${job.title}), first day ${day(3)}`);
    const list = data(await call("GET", `/api/corehr/people/${yasmine.employeeKey}/checklists`, null, amira))?.[0];
    const first = list?.tasks.find((task) => task.owner === "hr");
    if (first) await call("PUT", `/api/corehr/checklists/tasks/${first.id}`, { done: true }, amira);
  } else {
    console.log("Yasmine Trabelsi already hired");
  }

  const aichaMe = data(await call("GET", "/api/corehr/workforce/me", null, aicha)).employee;
  const people = `/api/corehr/employees/people/${aichaMe.stableEmployeeKey}`;
  const current = data(await call("GET", `${people}/personal`, null, amira));
  const birthday = `1994-${day(9).slice(5)}`;
  if (current.dateOfBirth !== birthday) {
    const r = await fetch(`${BASE}${people}/personal`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${amira}`, "If-Match": `"${current.version}"` },
      body: JSON.stringify({ preferredName: current.preferredName, mobile: current.mobile, personalEmail: current.personalEmail,
        homeAddress: current.homeAddress, dateOfBirth: birthday, emergencyContacts: current.emergencyContacts }),
    });
    if (r.status !== 200) throw new Error(`Aicha's birthday: ${r.status} ${await r.text()}`);
  }
  await call("PUT", "/api/corehr/me/birthday", { share: true }, aicha);
  console.log(`Aicha's birthday on ${birthday.slice(5)}, shared`);
}

seed().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
