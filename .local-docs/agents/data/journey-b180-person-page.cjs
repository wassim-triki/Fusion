// B-180 / B-214 API journey, through the shell like the browser:
//   node .local-docs/agents/data/journey-b180-person-page.cjs
// In Carthage Digital Group: Aicha (employee) reads her own page (employment dates, her history, her full Personal
// tab with who sees each part), changes her preferred name but not her date of birth (HR's), and adds a document;
// Mariam (her manager) sees her mobile but not her documents; Omar (a manager elsewhere) sees her preferred name only and
// neither her history nor her documents; Amira (HR) sees and removes the document; another company's administrator
// reaches none of it; the roles say Personal details have their own keys. Re-runnable: restores the preferred name and
// removes what it added.
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

async function upload(token, key, bytes, name, type) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), name);
  const r = await fetch(`${BASE}/api/corehr/employees/people/${key}/documents`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}

async function raw(token, url) {
  const r = await fetch(`${BASE}${url}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: r.status, bytes: Buffer.from(await r.arrayBuffer()), disposition: r.headers.get("content-disposition") };
}

(async () => {
  const amira = await login("amira.khelifi@example.test");
  const mariam = await login("mariam.gharbi@example.test");
  const omar = await login("omar.mansour@example.test");
  const aicha = await login("aicha.bouazizi@example.test");
  const elsewhere = await login("amira.khelifi@midyear-5.example.test");

  const aichaKey = data(await call("GET", "/api/corehr/employees/people?q=Aicha", null, amira)).items.find((p) => p.displayName.startsWith("Aicha")).employeeKey;
  const mariamKey = data(await call("GET", "/api/corehr/employees/people?q=Mariam", null, amira)).items[0].employeeKey;
  const people = `/api/corehr/employees/people/${aichaKey}`;

  // Left by an interrupted run.
  for (const doc of data(await call("GET", `${people}/documents`, null, amira))?.documents ?? []) {
    if (doc.name.startsWith("b180-")) await call("DELETE", `${people}/documents/${doc.id}`, null, amira);
  }

  // --- Her own page --------------------------------------------------------------------------------
  const own = data(await call("GET", people, null, aicha));
  check("Aicha opens her own page with her employment dates", Boolean(own?.employment?.start), own?.employment?.start);
  check("Aicha reads her own history", (await call("GET", `${people}/timeline`, null, aicha)).status === 200);
  check("…but not her manager's", (await call("GET", `/api/corehr/employees/people/${mariamKey}/timeline`, null, aicha)).status === 404);

  const personal = data(await call("GET", `${people}/personal`, null, aicha));
  check("her Personal tab is all hers", personal?.access === "Full" && personal?.canEdit === true);
  const audience = personal?.audience;
  check("it says who sees each part, from the roles", Boolean(audience) && audience.full.length > 0 && audience.contactTeam === true,
    JSON.stringify(audience));

  const body = (over) => ({
    preferredName: personal.preferredName,
    mobile: personal.mobile,
    personalEmail: personal.personalEmail,
    homeAddress: personal.homeAddress,
    dateOfBirth: personal.dateOfBirth,
    emergencyContacts: personal.emergencyContacts ?? [],
    ...over,
  });
  const put = async (token, request, version) => {
    const r = await fetch(`${BASE}/api/corehr/employees/people/${aichaKey}/personal`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "If-Match": `"${version}"` },
      body: JSON.stringify(request),
    });
    let json;
    try { json = await r.json(); } catch { json = null; }
    return { status: r.status, json };
  };
  check("she can't change her date of birth (HR's)", (await put(aicha, body({ dateOfBirth: "1990-01-01" }), personal.version)).status === 403);
  const renamed = await put(aicha, body({ preferredName: "Aïcha" }), personal.version);
  check("she changes her preferred name", renamed.status === 200 && data(renamed)?.preferredName === "Aïcha");
  const restored = await put(aicha, body({}), data(renamed).version);
  check("…and puts it back", restored.status === 200);

  const pdf = Buffer.from("%PDF-1.7\n% b180 journey\n");
  const added = await upload(aicha, aichaKey, pdf, "b180-diploma.pdf", "application/pdf");
  check("she adds a PDF to her documents", added.status === 200 && data(added)?.canRemove === true);
  const docId = data(added)?.id;
  check("a file that isn't a PDF or an image is refused", (await upload(aicha, aichaKey, Buffer.from("MZ not a pdf"), "b180-fake.pdf", "application/pdf")).status === 400);
  const file = await raw(aicha, `${people}/documents/${docId}`);
  check("she downloads it back, byte for byte", file.status === 200 && file.bytes.equals(pdf), file.disposition ?? "");

  // --- About: hers to write, everyone's to read -----------------------------------------------------
  const before = own?.identity?.about ?? null;
  const about = (token, text) => call("PUT", `${people}/about`, { about: text }, token);
  check("she writes her About", (await about(aicha, "I keep Consulting's releases boring.")).status === 200);
  check("Omar reads it on her page", data(await call("GET", people, null, omar))?.identity?.about === "I keep Consulting's releases boring.");
  check("Omar and Mariam can't write it", (await about(omar, "x")).status === 403 && (await about(mariam, "x")).status === 403);
  check("more than 1000 characters is refused", (await about(aicha, "x".repeat(1001))).status === 400);
  check("another company's administrator can't", (await about(elsewhere, "x")).status === 404);
  await about(aicha, before);

  // --- Her manager, a colleague, HR -------------------------------------------------------------------
  const asManager = data(await call("GET", `${people}/personal`, null, mariam));
  check("Mariam (her manager) sees her mobile and nothing private", asManager?.access === "Contact" && asManager.homeAddress === null);
  check("Mariam doesn't see her documents", (await call("GET", `${people}/documents`, null, mariam)).status === 403);
  check("…nor opens the file", (await raw(mariam, `${people}/documents/${docId}`)).status === 403);
  check("…nor adds one", (await upload(mariam, aichaKey, pdf, "b180-x.pdf", "application/pdf")).status === 403);

  const asColleague = data(await call("GET", `${people}/personal`, null, omar));
  check("Omar (a manager outside her branch) sees her preferred name only", asColleague?.access === "Directory" && asColleague.mobile === null);
  check("Omar doesn't see her mobile on the page either", data(await call("GET", people, null, omar))?.identity?.phone === null);
  check("Omar reads neither her history nor her documents",
    (await call("GET", `${people}/timeline`, null, omar)).status === 404 && (await call("GET", `${people}/documents`, null, omar)).status === 403);

  const asHr = data(await call("GET", `${people}/documents`, null, amira));
  check("Amira (HR) sees the document", asHr?.documents?.some((d) => d.id === docId) && asHr.canAdd === true);
  check("another company's administrator reaches none of it",
    (await call("GET", `${people}/documents`, null, elsewhere)).status === 404
      && (await raw(elsewhere, `${people}/documents/${docId}`)).status === 404
      && (await call("DELETE", `${people}/documents/${docId}`, null, elsewhere)).status === 404);
  check("Amira removes it", (await call("DELETE", `${people}/documents/${docId}`, null, amira)).status === 204);
  check("it's gone", !(data(await call("GET", `${people}/documents`, null, aicha))?.documents ?? []).some((d) => d.id === docId));

  // --- Roles: Personal details have their own keys (B-214) ------------------------------------------
  const roles = data(await call("GET", "/api/identity/core-access/roles", null, amira));
  const area = (roles?.areas ?? []).find((a) => a.id === "personal");
  const keys = new Set((area?.options ?? []).flatMap((o) => o.defining.map((g) => g.key)));
  check("the Personal details area is defined on its own keys", keys.has("core.personal.view") && keys.has("core.personal.manage") && !keys.has("core.employee.view"),
    [...keys].join(", "));

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
