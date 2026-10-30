// B-175: gives the Carthage tenants' jobs their families and levels (demo-presets/jobs.mjs). New preset builds do this
// themselves; run it once for tenants built before B-175.
//
//   node .local-docs/agents/data/group-carthage-jobs.mjs                 every built preset and Carthage Digital Group
//   node .local-docs/agents/data/group-carthage-jobs.mjs midyear yearend only these presets
//
// Signs in as Amira Khelifi, the tenant administrator, of each tenant (local password, FUSION_LOCAL_PASSWORD).
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { as } from "./demo-presets/client.mjs";
import { groupJobs } from "./demo-presets/jobs.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await fs.readFile(path.join(here, "demo-presets.local.json"), "utf8"));
const wanted = process.argv.slice(2);
const targets = Object.entries(manifest.presets)
  .filter(([key]) => wanted.length === 0 || wanted.includes(key))
  .map(([key, preset]) => [key, `amira.khelifi@${preset.domain}`]);
if (wanted.length === 0 || wanted.includes("carthage")) targets.push(["carthage", "amira.khelifi@example.test"]);

for (const [key, email] of targets) {
  try {
    await groupJobs(as(email), (line) => console.log(`${key}: ${line}`));
  } catch (error) {
    console.error(`${key}: ${error.message}`);
    process.exitCode = 1;
  }
}
