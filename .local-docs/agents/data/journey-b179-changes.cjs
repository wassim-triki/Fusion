// B-179 API journey, through the shell like the browser:
//   node .local-docs/agents/data/journey-b179-changes.cjs
// In Carthage Digital Group:
// - Amira Khelifi (administrator, HR) turns approval on for job changes and home addresses.
// - Mariam Gharbi (manager, Propose for her team) describes "Promote Aicha … from <first of next month>", Fusion
//   drafts it from the company's jobs and reasons, and she sends it; nothing is written to Aicha yet.
// - Refused: Leila (employee) proposing, Mariam proposing for someone outside her team or for herself, Mariam
//   approving, Omar (another manager) seeing Mariam's request, an administrator of another company reading it, a
//   decline without a reason.
// - Amira finds it on Home (Core HR work item with approve/decline paths) and approves it in one call; Aicha's job is
//   unchanged today and new on the date; Mariam hears it was approved, Aicha hears her job changes.
// - Aicha changes her own home address: it waits for HR, she withdraws it.
// Leaves Carthage as it found it: the applied change is cancelled and the approval settings restored.
const path = require("path");
const { call, login } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const data = (r) => r.json?.data;
const results = [];
function check(label, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  return ok;
}
const iso = (d) => d.toISOString().slice(0, 10);
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

(async () => {
  const amira = await login("amira.khelifi@example.test");
  const mariam = await login("mariam.gharbi@example.test");
  const leila = await login("leila.baccouche@example.test");
  const omar = await login("omar.mansour@example.test");
  const aicha = await login("aicha.bouazizi@example.test");
  const elsewhere = await login("amira.khelifi@midyear-5.example.test");

  const before = data(await call("GET", "/api/corehr/changes/approvals", null, amira));
  const restore = before.types.filter((type) => type.required).map((type) => type.type);
  check("Amira turns approval on for job changes and home addresses",
    (await call("PUT", "/api/corehr/changes/approvals", { required: ["job", "homeAddress"] }, amira)).status === 200);
  const seen = data(await call("GET", "/api/corehr/changes/approvals", null, mariam));
  check("Mariam reads who approves", seen.approvers.some((a) => a.displayName.startsWith("Amira")), seen.approvers.map((a) => a.displayName).join(", "));
  check("Mariam can't change the settings", (await call("PUT", "/api/corehr/changes/approvals", { required: [] }, mariam)).status === 403);

  // Aicha, on Mariam's team, and a job one step up.
  const people = data(await call("GET", "/api/corehr/employees/people?q=Aicha", null, amira));
  const aichaKey = people.items.find((p) => p.displayName.startsWith("Aicha")).employeeKey;
  const profile = data(await call("GET", `/api/corehr/employees/people/${aichaKey}`, null, amira));
  const jobs = data(await call("GET", "/api/corehr/catalog/jobs", null, amira)).filter((j) => !j.isRetired);
  const target = jobs.find((j) => j.title === `Senior ${profile.work.jobTitle}`) ?? jobs.find((j) => j.id !== profile.work.jobId && j.title.startsWith("Senior"));
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const sentence = `Promote Aicha to ${target.title} from 1 ${months[first.getUTCMonth()]}`;

  const draft = data(await call("POST", `/api/corehr/changes/people/${aichaKey}/draft`, { text: sentence }, mariam));
  check("Fusion drafts the job, the reason and the date from the sentence",
    draft?.jobId === target.id && draft?.reason === "Promotion" && draft?.date === iso(first),
    `${draft?.jobTitle} · ${draft?.reason} · ${draft?.date} · ${draft?.usedAi ? "AI" : "words"}`);

  const job = { effectiveDate: draft.date, jobId: draft.jobId, reasonId: draft.reasonId, note: "She owns the regression suite and runs the QA guild." };
  check("Leila (employee) can't propose", (await call("POST", `/api/corehr/changes/people/${aichaKey}/propose`, { job }, leila)).status === 403);
  const leilaKey = data(await call("GET", "/api/corehr/employees/people?q=Leila", null, amira)).items[0].employeeKey;
  check("Mariam can't propose for someone outside her team",
    (await call("POST", `/api/corehr/changes/people/${leilaKey}/propose`, { job: { effectiveDate: draft.date, jobId: target.id } }, mariam)).status === 403);
  const mariamKey = data(await call("GET", "/api/corehr/employees/people?q=Mariam", null, amira)).items[0].employeeKey;
  check("Mariam can't propose for herself",
    (await call("POST", `/api/corehr/changes/people/${mariamKey}/propose`, { job: { effectiveDate: draft.date, jobId: target.id } }, mariam)).status === 403);

  const proposed = await call("POST", `/api/corehr/changes/people/${aichaKey}/propose`, { job, description: sentence }, mariam);
  const request = data(proposed)?.request;
  check("Mariam's promotion waits for approval", proposed.status === 200 && request?.status === "Pending" && !data(proposed).change,
    `${proposed.status} ${request?.types}`);
  const still = data(await call("GET", `/api/corehr/employees/people/${aichaKey}`, null, amira));
  check("Nothing is written to Aicha yet", still.work.jobTitle === profile.work.jobTitle && still.comingUp.length === profile.comingUp.length);

  check("Mariam can't approve", (await call("POST", `/api/corehr/changes/requests/${request.id}/approve`, {}, mariam)).status === 403);
  check("Omar doesn't see Mariam's request", (await call("GET", `/api/corehr/changes/requests/${request.id}`, null, omar)).status === 404);
  check("An administrator of another company can't read it", (await call("GET", `/api/corehr/changes/requests/${request.id}`, null, elsewhere)).status === 404);
  check("A no needs a reason", (await call("POST", `/api/corehr/changes/requests/${request.id}/decline`, { reason: " " }, amira)).status === 400);

  const work = data(await call("GET", "/api/corehr/work", null, amira));
  const item = work.find((w) => w.id === `core:change-request:${request.id}`);
  check("Amira finds it in Needs you with approve and decline", Boolean(item?.decision), item ? `${item.title} — ${item.context}` : "missing");
  const approved = await call("POST", `/api/corehr${item.decision.approvePath}`, {}, amira);
  check("Amira approves from Home in one call", approved.status === 200 && data(approved)?.status === "Approved");
  check("The work item is gone", !data(await call("GET", "/api/corehr/work", null, amira)).some((w) => w.id === item.id));

  const today = data(await call("GET", `/api/corehr/employees/people/${aichaKey}`, null, amira));
  const onDate = data(await call("GET", `/api/corehr/employees/people/${aichaKey}?asOf=${draft.date}`, null, amira));
  check("Applied on its date: today unchanged, the date shows the new job",
    today.work.jobTitle === profile.work.jobTitle && onDate.work.jobTitle === target.title, `${today.work.jobTitle} → ${onDate.work.jobTitle}`);
  const mariamFeed = data(await call("GET", "/api/corehr/notifications", null, mariam));
  check("Mariam hears it was approved", mariamFeed.items.some((n) => n.kind === "ChangeApproved"), mariamFeed.items[0]?.title);
  const aichaFeed = data(await call("GET", "/api/corehr/notifications", null, aicha));
  check("Aicha hears her job changes", aichaFeed.items.some((n) => n.kind === "JobChanged"), aichaFeed.items[0]?.title);

  // Self-service: a home address waits for HR and can be withdrawn.
  const personal = await call("GET", `/api/corehr/employees/people/${aichaKey}/personal`, null, aicha);
  const p = data(personal);
  const updated = await fetch(`http://localhost:3000/api/corehr/employees/people/${aichaKey}/personal`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${aicha}`, "If-Match": `"${p.version}"` },
    body: JSON.stringify({ preferredName: p.preferredName, mobile: p.mobile, personalEmail: p.personalEmail,
      homeAddress: { street: "4 Avenue de la Liberté", city: "Ariana", postalCode: "2080", country: "Tunisia" },
      dateOfBirth: p.dateOfBirth, emergencyContacts: p.emergencyContacts ?? [] }),
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  const pending = updated.json?.data?.pendingHomeAddress;
  check("Aicha's new address waits for HR", updated.status === 200 && pending?.address.street === "4 Avenue de la Liberté"
    && updated.json.data.homeAddress?.street !== "4 Avenue de la Liberté", `${updated.status}`);
  check("Amira can't withdraw Aicha's request", (await call("POST", `/api/corehr/changes/requests/${pending.requestId}/withdraw`, {}, amira)).status === 403);
  check("Aicha withdraws it", data(await call("POST", `/api/corehr/changes/requests/${pending.requestId}/withdraw`, {}, aicha))?.status === "Withdrawn");

  // Leave Carthage as it was.
  const cancel = await call("POST", `/api/corehr/employees/people/changes/${data(approved).appliedChangeId}/cancel`, {}, amira);
  check("Clean-up: the promotion is cancelled", cancel.status === 204, `${cancel.status}`);
  await call("PUT", "/api/corehr/changes/approvals", { required: restore }, amira);

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
