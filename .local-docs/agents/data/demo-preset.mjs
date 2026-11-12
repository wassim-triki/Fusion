// Demo presets (B-095, D-40/D-41): each preset is its own Carthage tenant at one point of the performance year,
// relative to the day it is built, written through the product API (the gateway) with the Development-only demo clock.
//   node .local-docs/agents/data/demo-preset.mjs list
//   node .local-docs/agents/data/demo-preset.mjs build <fresh|planning|sitting|midyear|yearend|nextcycle>   (no-op if built)
//   node .local-docs/agents/data/demo-preset.mjs reset <preset>   (builds a new one, then retires the old one)
//   node .local-docs/agents/data/demo-preset.mjs tidy   (archives every retired or failed preset tenant still listed)
// Accounts use the local password (README) at <preset>-<n>.example.test; the manifest demo-presets.local.json records
// tenants, domains, run dates, cycles and personas. Nothing is deleted: a retired tenant is renamed and archived, which takes
// it out of the platform list.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, as } from "./demo-presets/client.mjs";
import { buildFoundation, PLATFORM_ADMIN } from "./demo-presets/foundation.mjs";
import { activateEveryone } from "./demo-presets/accounts.mjs";
import { PRESETS } from "./demo-presets/presets.mjs";
import { P, Timeline, storyContext, utcDay, ymd } from "./demo-presets/year.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(here, "demo-presets.local.json");
const started = Date.now();
const log = (message) => console.log(`[${((Date.now() - started) / 1000).toFixed(0).padStart(4)}s] ${message}`);

async function readManifest() {
  try { return JSON.parse(await fs.readFile(manifestPath, "utf8")); }
  catch { return { presets: {}, builds: {}, retired: [] }; }
}
/** Read, change, write: another run may have recorded its own preset since this one started. */
async function updateManifest(change) {
  const manifest = await readManifest();
  change(manifest);
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/** Stops before any write unless Performance runs the demo clock: a future instant must be refused as invalid. */
async function probe() {
  const token = await as(PLATFORM_ADMIN).auth();
  const response = await fetch(`${BASE}/api/performance/work`, {
    headers: { Authorization: `Bearer ${token}`, "X-Demo-Clock": new Date(Date.now() + 86_400_000).toISOString() },
  });
  const code = (await response.json().catch(() => null))?.details?.code;
  if (code === "demo_clock_unavailable") throw new Error("Performance isn't running in Development: the demo clock is refused. Nothing was written.");
  if (code !== "demo_clock_invalid") throw new Error(`Performance doesn't answer the demo clock (status ${response.status}); restart it with the current build. Nothing was written.`);
}

async function retire(tenantId, name) {
  const platform = as(PLATFORM_ADMIN);
  await platform.post(`/api/identity/platform-admin/tenants/${tenantId}/rename`, { name });
  await platform.post(`/api/identity/platform-admin/tenants/${tenantId}/archive`, {});
}

/**
 * Leftovers of interrupted builds (a killed process never ran its cleanup) are retired as failed. Returns the highest
 * build number any tenant of this preset uses, so a new build never reuses a domain (emails are global).
 */
async function sweep(key, name, today) {
  const { rows } = await as(PLATFORM_ADMIN).get("/api/identity/platform-admin/tenants?pageSize=200");
  let highest = 0;
  for (const row of rows) {
    const used = (row.initialAdministratorEmail ?? "").match(/@([a-z]+)-(\d+)\.example\.test$/);
    if (used?.[1] === key) highest = Math.max(highest, Number(used[2]));
    // Retired before archival existed (renamed and deactivated): the list still shows them.
    if (row.name.startsWith(`${name} · retired `) || row.name.startsWith(`${name} · failed `)) {
      await as(PLATFORM_ADMIN).post(`/api/identity/platform-admin/tenants/${row.tenantId}/archive`, {});
      log(`archived ${row.name}`);
      continue;
    }
    const match = row.name.startsWith(`${name} · build `) && /^\d+$/.exec(row.name.slice(`${name} · build `.length));
    if (!match) continue;
    const build = Number(match[0]);
    await retire(row.tenantId, `${name} · failed ${today} #${build}`);
    await updateManifest((m) => {
      if (!m.retired.some((r) => r.tenantId === row.tenantId)) m.retired.push({ preset: key, tenantId: row.tenantId, build, failedOn: today });
    });
    log(`retired the interrupted build ${build}`);
  }
  return highest;
}

function personas(people) {
  const pick = (index, access) => ({ name: people[index - 1].name, email: people[index - 1].email, access });
  return [
    pick(P.AMIRA, "Tenant administrator, HR, manager"),
    pick(P.MARIAM, "Manager (reviews Aicha)"),
    pick(P.OMAR, "Manager, rates generously, no core.team.view"),
    pick(P.AICHA, "Employee"),
    pick(P.LEILA, "Employee"),
    pick(P.KHALED, "Employee"),
    pick(P.RIM, "Employee"),
  ];
}

function print(key, entry) {
  console.log(`\n${entry.name}  (${key}, built ${entry.runDate}, ${entry.domain})`);
  console.log(`  ${PRESETS[key].summary}`);
  for (const p of entry.personas) console.log(`  ${p.name.padEnd(18)} ${p.email.padEnd(42)} ${p.access}`);
  console.log("  Password: the local demo password in data/README.md");
}

async function build(key) {
  const preset = PRESETS[key];
  await probe();
  const runDay = utcDay(new Date());
  const name = `Carthage · ${preset.label}`;
  const highest = await sweep(key, name, ymd(runDay));
  let n;
  await updateManifest((m) => { n = Math.max(m.builds[key] ?? 0, highest) + 1; m.builds[key] = n; });
  const domain = `${key}-${n}.example.test`;
  // Tenant names and slugs are unique; the build number keeps the in-progress name apart from every earlier one.
  const building = `${name} · build ${n}`;
  const { asOf, schedule } = preset.plan(runDay);
  log(`building ${name} at ${domain}, foundation as of ${ymd(asOf)}`);

  let tenantId;
  try {
    const foundation = await buildFoundation({ name: building, domain, asOf: ymd(asOf), work: path.join(here, "demo-presets", ".work", `${key}-${n}`), log });
    tenantId = foundation.tenantId;
    await activateEveryone(foundation.people, log);
    const ctx = storyContext(foundation.people);
    const timeline = new Timeline(new Date().toISOString(), log);
    schedule(timeline, ctx);
    const steps = await timeline.run();
    log(`${steps} dated steps written`);

    const previous = (await readManifest()).presets[key];
    if (previous) {
      await retire(previous.tenantId, `${name} · retired ${ymd(runDay)} #${previous.build}`);
      await updateManifest((m) => m.retired.push({ preset: key, tenantId: previous.tenantId, build: previous.build, domain: previous.domain, retiredOn: ymd(runDay) }));
      log(`retired the previous ${name} (build ${previous.build})`);
    }
    await as(PLATFORM_ADMIN).post(`/api/identity/platform-admin/tenants/${tenantId}/rename`, { name });
    const entry = {
      name, tenantId, build: n, domain, runDate: ymd(runDay), asOf: ymd(asOf),
      cycles: Object.fromEntries(Object.entries(ctx.cycles).map(([k, c]) => [k, { id: c.id, name: c.name, start: ymd(c.start), end: ymd(c.end), roundId: c.round?.id ?? null }])),
      employees: Object.fromEntries(foundation.people.map((p) => [p.employeeNumber, { id: p.employeeId, name: p.name, email: p.email }])),
      personas: personas(foundation.people),
    };
    await updateManifest((m) => { m.presets[key] = entry; });
    print(key, entry);
  } catch (error) {
    if (tenantId) {
      await retire(tenantId, `${name} · failed ${new Date().toISOString().slice(0, 16).replace("T", " ")} #${n}`)
        .catch((cleanup) => log(`couldn't retire ${building} (${cleanup.message}); the next build retires it`));
      await updateManifest((m) => m.retired.push({ preset: key, tenantId, build: n, domain, failedOn: ymd(runDay) }));
    }
    throw error;
  }
}

const [command, key] = process.argv.slice(2);
const manifest = await readManifest();
try {
  if (command === "list") {
    for (const [k, preset] of Object.entries(PRESETS)) {
      const entry = manifest.presets[k];
      console.log(`${k.padEnd(10)} ${preset.label.padEnd(11)} ${entry ? `built ${entry.runDate} at ${entry.domain}` : "not built"}  ${preset.summary}`);
    }
    if (manifest.retired.length) console.log(`\n${manifest.retired.length} retired or failed tenant(s) in the manifest.`);
  } else if (command === "tidy") {
    const { rows } = await as(PLATFORM_ADMIN).get("/api/identity/platform-admin/tenants?pageSize=200");
    const leftovers = rows.filter((row) => /^Carthage · .+ · (retired|failed) /.test(row.name));
    for (const row of leftovers) {
      await as(PLATFORM_ADMIN).post(`/api/identity/platform-admin/tenants/${row.tenantId}/archive`, {});
      log(`archived ${row.name}`);
    }
    log(`${leftovers.length} tenant(s) archived`);
  } else if ((command === "build" || command === "reset") && PRESETS[key]) {
    if (command === "build" && manifest.presets[key]) print(key, manifest.presets[key]);
    else await build(key);
  } else {
    console.error(`usage: demo-preset.mjs list | build <preset> | reset <preset> | tidy\npresets: ${Object.keys(PRESETS).join(", ")}`);
    process.exitCode = 2;
  }
} catch (error) {
  console.error(`\nBuild stopped: ${error.message}`);
  process.exitCode = 1;
}
