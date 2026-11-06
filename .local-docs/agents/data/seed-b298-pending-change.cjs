// B-298: one change waiting for a decision in Carthage, so the approval is there to see when walking around.
// Amira Khelifi, the administrator, keeps approval on for job changes; Mariam Gharbi, a manager, proposes promoting
// Aicha Bouazizi from the first of next month. Does nothing if a request is already pending.
// Run: node .local-docs/agents/data/seed-b298-pending-change.cjs   (stack up; FUSION_LOCAL_PASSWORD set)
const { call, login } = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");

const data = (response, what) => {
  if (response.status >= 300) throw new Error(`${what}: ${response.status} ${JSON.stringify(response.json).slice(0, 300)}`);
  return response.json?.data;
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

(async () => {
  const amira = await login("amira.khelifi@example.test");
  const mariam = await login("mariam.gharbi@example.test");

  const people = data(await call("GET", "/api/corehr/employees/people?q=Aicha", null, amira), "people");
  const aichaKey = people.items.find((person) => person.displayName.startsWith("Aicha")).employeeKey;
  const profile = data(await call("GET", `/api/corehr/employees/people/${aichaKey}`, null, amira), "profile");

  const approvals = data(await call("GET", "/api/corehr/changes/approvals", null, amira), "approvals");
  const required = approvals.types.filter((type) => type.required).map((type) => type.type);
  if (!required.includes("job")) data(await call("PUT", "/api/corehr/changes/approvals", { required: [...required, "job"] }, amira), "approval on");

  const jobs = data(await call("GET", "/api/corehr/catalog/jobs", null, amira), "jobs").filter((job) => !job.isRetired);
  const target = jobs.find((job) => job.title === `Senior ${profile.work.jobTitle}`)
    ?? jobs.find((job) => job.id !== profile.work.jobId && job.title.startsWith("Senior"));
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const effectiveDate = first.toISOString().slice(0, 10);
  const description = `Promote Aicha to ${target.title} from 1 ${MONTHS[first.getUTCMonth()]}`;

  const proposed = await call("POST", `/api/corehr/changes/people/${aichaKey}/propose`, { job: { effectiveDate, jobId: target.id }, description }, mariam);
  if (proposed.status === 409) return console.log("A request is already pending:", JSON.stringify(proposed.json).slice(0, 200));
  const request = data(proposed, "propose")?.request;
  console.log(`${description}: ${request?.status ?? "applied without approval"}`);
})().catch((error) => { console.error(String(error).slice(0, 500)); process.exit(1); });
