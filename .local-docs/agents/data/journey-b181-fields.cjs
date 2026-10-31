// B-181 API journey, through the shell like the browser, and Carthage's demo field set:
//   node .local-docs/agents/data/journey-b181-fields.cjs
// In Carthage Digital Group: Amira (HR) reads the company's fields and switches on the ready-made Skills and Languages
// spoken (Everyone sees them, the person changes them); a stale or missing version is refused, a new field under Job is
// refused, the old settings path no longer takes field policy. Aicha (employee) fills her Skills and Languages as drawn;
// Mariam (her manager) can't change them; Omar (a colleague) sees them; Aicha can't open the field settings; another
// company's administrator reaches none of it. Re-runnable: leaves Skills and Languages on with Aicha's values.
const path = require("path");
const { call, login } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const BASE = "http://localhost:3000";
const data = (r) => r.json?.data;
const results = [];
function check(label, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  return ok;
}

async function put(token, url, body, ifMatch) {
  const r = await fetch(`${BASE}${url}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(ifMatch ? { "If-Match": `"${ifMatch}"` } : {}) },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}

const input = (field) => ({
  id: field.id, key: field.key, label: field.label, area: field.area, type: field.type, changedBy: field.changedBy,
  visible: field.visible, visibleToEmployee: field.visibleToEmployee, visibleToManager: field.visibleToManager,
  required: field.required, sortOrder: field.sortOrder, galleryKey: field.galleryKey,
});

(async () => {
  const amira = await login("amira.khelifi@example.test");
  const mariam = await login("mariam.gharbi@example.test");
  const omar = await login("omar.mansour@example.test");
  const aicha = await login("aicha.bouazizi@example.test");
  const elsewhere = await login("amira.khelifi@midyear-5.example.test");

  const aichaKey = data(await call("GET", "/api/corehr/employees/people?q=Aicha", null, amira)).items.find((p) => p.displayName.startsWith("Aicha")).employeeKey;
  const fieldsUrl = `/api/corehr/employees/people/${aichaKey}/fields`;

  // --- The company's fields -------------------------------------------------------------------------
  const settings = await call("GET", "/api/corehr/settings/fields", null, amira);
  check("Amira reads the company's fields, grouped About / Personal / Job", settings.status === 200
    && ["About", "Personal", "Job"].every((area) => data(settings).fields.some((f) => f.area === area)), `v${data(settings)?.version}`);
  check("…with the ready-made gallery", data(settings).gallery.some((g) => g.key === "skills"));
  check("Aicha can't open the field settings", (await call("GET", "/api/corehr/settings/fields", null, aicha)).status === 403);

  const current = data(settings);
  const fields = current.fields.map(input);
  for (const [key, label, sortOrder] of [["skills", "Skills", 20], ["languages-spoken", "Languages spoken", 30]]) {
    if (!fields.some((f) => f.key === key)) {
      fields.push({ id: null, key, label, area: "About", type: "Tags", changedBy: "Employee", visible: true,
        visibleToEmployee: true, visibleToManager: true, required: false, sortOrder, galleryKey: key });
    }
  }
  check("A save without the version is refused", (await put(amira, "/api/corehr/settings/fields", { fields })).status === 409);
  check("A save on a stale version is refused", (await put(amira, "/api/corehr/settings/fields", { fields }, (current.version ?? 0) + 99)).status === 409);
  const job = await put(amira, "/api/corehr/settings/fields", { fields: [...fields, { id: null, key: "grade", label: "Grade", area: "Job",
    type: "Text", changedBy: "DatedChange", visible: true, visibleToEmployee: true, visibleToManager: true, required: false, sortOrder: 90, galleryKey: null }] }, current.version);
  check("A new field under Job is refused", job.status === 400, job.json?.message);
  const legacy = await fetch(`${BASE}/api/corehr/settings/people-data`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${amira}` },
    body: JSON.stringify({ employeeFieldConfig: { phone: { required: true } } }),
  });
  check("The old settings path no longer takes field policy", legacy.status === 400);
  check("Aicha can't save the company's fields", (await put(aicha, "/api/corehr/settings/fields", { fields }, current.version)).status === 403);

  const saved = await put(amira, "/api/corehr/settings/fields", { fields }, current.version);
  check("Amira switches on Skills and Languages spoken", saved.status === 200
    && ["skills", "languages-spoken"].every((key) => data(saved).fields.some((f) => f.key === key)), `v${data(saved)?.version}`);

  // --- On Aicha's page ------------------------------------------------------------------------------
  const own = data(await call("GET", fieldsUrl, null, aicha));
  check("Aicha sees both on her page and can change them", ["skills", "languages-spoken"].every((key) => own?.find((f) => f.key === key)?.canEdit));
  const skills = await put(aicha, `${fieldsUrl}/skills`, { value: ["Playwright", "Test automation", "API testing"] });
  const languages = await put(aicha, `${fieldsUrl}/languages-spoken`, { value: ["Arabic", "French", "English"] });
  check("Aicha fills her Skills and Languages", skills.status === 200 && languages.status === 200);
  check("…a tag list must be a list", (await put(aicha, `${fieldsUrl}/skills`, { value: "Playwright" })).status === 400);
  check("Mariam, her manager, can't change them", (await put(mariam, `${fieldsUrl}/skills`, { value: ["Nope"] })).status === 403);
  const seen = data(await call("GET", fieldsUrl, null, omar));
  check("Omar, a colleague, sees them, read-only", seen?.find((f) => f.key === "skills")?.value?.length === 3
    && seen.every((f) => !f.canEdit));
  check("Another company's administrator reaches none of it", (await call("GET", fieldsUrl, null, elsewhere)).status === 404
    && (await put(elsewhere, `${fieldsUrl}/skills`, { value: ["x"] })).status === 404);

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
