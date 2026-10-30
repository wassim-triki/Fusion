// B-176 API journey, through the shell like the browser:
//   node .local-docs/agents/data/journey-b176-brand.cjs [--keep]
// In Carthage Digital Group, Amira (tenant administrator) previews the invitation email in Arabic, then saves a brand:
// a logo, a blue, Arabic as the default language. Sign-in reads it by the workspace address without signing in; the
// logo is served at a versioned address. Rim (settings view only) and Aicha (employee) can't save; a bad colour, an
// SVG and another company's name are refused; another company's brand doesn't move. An administrator invitation sent
// after the save arrives in Arabic with the logo inside and the button in the blue.
// Ends by putting the brand back as it was, unless --keep (then the brand stays for screens).
const path = require("path");
const zlib = require("zlib");
const { BASE, MAILPIT, call, login } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const keep = process.argv.includes("--keep");
const data = (r) => r.json?.data;
const results = [];
function check(label, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  return ok;
}
const stamp = Date.now().toString(36).slice(-5);

/** A 96×96 PNG: a deep purple tile with a teal disc, the kind of logo the studio takes colours from. */
function logoPng() {
  const size = 96;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = [0];
    for (let x = 0; x < size; x++) {
      const inDisc = (x - 62) ** 2 + (y - 62) ** 2 < 22 ** 2;
      const inTile = x > 6 && x < 90 && y > 6 && y < 90;
      const [r, g, b, a] = inDisc ? [15, 124, 120, 255] : inTile ? [142, 42, 110, 255] : [0, 0, 0, 0];
      row.push(r, g, b, a);
    }
    rows.push(Buffer.from(row));
  }
  const chunk = (type, body) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function newestMail(email, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=to:${encodeURIComponent(email)}`)).json();
    const message = list.messages?.[0];
    if (message) return (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json();
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return null;
}

(async () => {
  const [amira, rim, aicha, other] = await Promise.all([
    login("amira.khelifi@example.test"),
    login("rim.mahjoub@example.test"),
    login("aicha.bouazizi@example.test"),
    login("amira.khelifi@yearend-2.example.test"),
  ]);
  const SUMMARY = "/api/identity/tenant-context/tenant-summary";
  const before = data(await call("GET", SUMMARY, null, amira));
  const otherBefore = data(await call("GET", SUMMARY, null, other));
  check("1. Amira reads her company's brand", Boolean(before?.name && before.slug), `${before?.name}, ${before?.brandColor ?? "Fusion's colour"}`);

  const preview = await call("POST", "/api/identity/brand/email-preview",
    { name: before.name, color: "#2f5fd0", language: "ar", hasLogo: true }, amira);
  const html = data(preview)?.html ?? "";
  check("2. The email preview is the invitation in Arabic, right to left, in the draft colour, nothing saved",
    preview.status === 200 && html.includes('dir="rtl"') && html.includes("background:#2f5fd0") && html.includes("cid:company-logo"));
  check("3. The preview saved nothing", data(await call("GET", SUMMARY, null, amira))?.brandColor === before.brandColor);

  const png = logoPng().toString("base64");
  const brand = { name: before.name, color: "#2f5fd0", language: "ar", logo: "replace", logoPng: png };
  check("4. Signed out, nobody saves a brand", (await call("PUT", "/api/identity/brand", brand, null)).status === 401);
  check("5. Rim, who may only view settings, can't save it", (await call("PUT", "/api/identity/brand", brand, rim)).status === 403);
  check("6. Aicha, an employee, can't save it", (await call("PUT", "/api/identity/brand", brand, aicha)).status === 403);
  check("7. Nor can she preview the email", (await call("POST", "/api/identity/brand/email-preview",
    { name: "x", color: null, language: "en", hasLogo: false }, aicha)).status === 403);

  check("8. A colour that isn't #rrggbb is refused",
    (await call("PUT", "/api/identity/brand", { ...brand, color: "blue" }, amira)).status === 400);
  check("9. An SVG is refused as a logo",
    (await call("PUT", "/api/identity/brand", { ...brand, logoPng: Buffer.from("<svg onload='x'/>").toString("base64") }, amira)).status === 400);
  if (otherBefore?.name) {
    check("10. Another company's name is refused",
      (await call("PUT", "/api/identity/brand", { ...brand, name: otherBefore.name }, amira)).status === 409);
  }

  const saved = await call("PUT", "/api/identity/brand", brand, amira);
  const after = data(saved);
  check("11. Amira saves logo, colour and language in one go",
    saved.status === 200 && after?.brandColor === "#2f5fd0" && after.language === "ar" && after.logoUrl?.startsWith("/api/identity/brand/logos/"),
    after?.logoUrl);

  const publicBrand = await fetch(`${BASE}/api/identity/brand/companies/${before.slug}`);
  const shown = (await publicBrand.json()).data;
  check("12. Sign-in reads the brand by the workspace address, signed out",
    publicBrand.status === 200 && shown.color === "#2f5fd0" && shown.language === "ar" && shown.logoUrl === after.logoUrl
      && Object.keys(shown).sort().join() === "color,language,logoUrl,name,slug");
  const logo = await fetch(`${BASE}${after.logoUrl}`);
  check("13. The logo is served signed out, as a PNG cached for good",
    logo.status === 200 && logo.headers.get("content-type") === "image/png" && /immutable/.test(logo.headers.get("cache-control") ?? ""));
  check("14. An unknown workspace has no brand", (await fetch(`${BASE}/api/identity/brand/companies/nobody-${stamp}`)).status === 404);
  check("15. Another company's brand didn't move", data(await call("GET", SUMMARY, null, other))?.brandColor === otherBefore?.brandColor);

  const email = `brand.journey.${stamp}@example.test`;
  const invited = await call("POST", "/api/identity/tenant-access/invitations", { email, firstName: "Brand", lastName: "Journey" }, amira);
  const mail = await newestMail(email);
  check("16. An invitation sent now arrives in Arabic, in the company's colour, with the logo inside",
    Boolean(mail) && mail.HTML.includes('dir="rtl"') && mail.HTML.includes("background:#2f5fd0")
      && mail.HTML.includes("cid:company-logo") && (mail.Inline ?? []).some((part) => part.ContentID === "company-logo"),
    mail ? mail.Subject : `${invited.status}`);
  const invitationId = data(invited)?.invitationId ?? data(invited)?.id;
  if (invitationId) await call("POST", `/api/identity/tenant-access/invitations/${invitationId}/revoke`, null, amira);

  if (!keep) {
    const restored = await call("PUT", "/api/identity/brand", {
      name: before.name, color: before.brandColor ?? null, language: before.language ?? "en",
      logo: before.logoUrl ? "keep" : "remove", logoPng: null,
    }, amira);
    check("17. The brand goes back as it was", restored.status === 200 && data(restored)?.brandColor === (before.brandColor ?? null));
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
