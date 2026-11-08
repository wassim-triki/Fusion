// Usage:
//   node .local-docs/agents/data/set-carthage-welcome-line.cjs ["the line"]
// B-210 demo data: Amira (tenant administrator) gives Carthage Digital Group's sign-in page a welcome line through
// the brand save, keeping the name, colour, language and logo as they are. An empty argument clears it. Re-runnable.
const path = require("path");
const { call, login } = require(path.join(__dirname, "../../../.agents/skills/fusion-dev/scripts/api.cjs"));

const LINE = process.argv[2] ?? "Good to see you. Your day, your team and your plan are one sign-in away.";
const SUMMARY = "/api/identity/tenant-context/tenant-summary";

(async () => {
  const amira = await login("amira.khelifi@example.test");
  const before = (await call("GET", SUMMARY, null, amira)).json?.data;
  if (!before) throw new Error("Carthage's brand didn't load");
  const saved = await call("PUT", "/api/identity/brand", {
    name: before.name,
    color: before.brandColor ?? null,
    language: before.language ?? "en",
    logo: "keep",
    welcomeLine: LINE || null,
  }, amira);
  if (saved.status !== 200) throw new Error(`Save refused: ${saved.status} ${JSON.stringify(saved.json)}`);
  console.log(`${before.name} (${before.slug}): welcome line ${saved.json.data.welcomeLine ? `"${saved.json.data.welcomeLine}"` : "cleared"}`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
