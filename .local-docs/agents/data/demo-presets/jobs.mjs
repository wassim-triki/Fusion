// B-175: groups a Carthage tenant's jobs into families and levels through the catalogue API. The workforce import (and,
// for older tenants, the migration) makes one job per title; this gives each a family from the company's "Job families"
// list (added when missing) and a level from its "Levels" list (the defaults). Safe to run again: it only sets what differs.

/** Families in the order the catalogue shows them, each with the words that put a title in it (first match wins). */
const FAMILIES = [
  ["Leadership", [/^chief /i]],
  ["Data and AI", [/\bdata\b/i, /machine learning/i, /\bai\b/i]],
  ["Product and Design", [/product/i, /design/i, /\bux\b/i]],
  ["Engineering", [/engineer/i, /cloud/i, /security/i, /architect/i, /\bqa\b/i]],
  ["Consulting and Delivery", [/consult/i, /delivery/i, /project/i, /customer success/i, /business analyst/i, /client/i]],
  ["Finance and Operations", [/finance/i, /operations analyst/i]],
  ["People", [/people/i, /recruit/i]],
  ["Marketing", [/marketing/i]],
];

/** A title's level among the defaults (Junior, Mid-level, Senior, Lead, Manager, Director, Executive). */
function levelOf(title) {
  if (/^chief /i.test(title)) return "Executive";
  if (/^vp\b/i.test(title)) return "Director";
  if (/manager/i.test(title)) return "Manager";
  if (/architect|lead\b/i.test(title)) return "Lead";
  if (/^senior /i.test(title)) return "Senior";
  return "Mid-level";
}

function familyOf(title) {
  // A VP or a manager sits in the family of what they run ("VP, Engineering" → Engineering).
  return FAMILIES.find(([, words]) => words.some((word) => word.test(title)))?.[0] ?? null;
}

/**
 * Gives every job of the session's tenant its family and level. `session` has get/post/put (demo-presets/client.mjs
 * Session) and belongs to someone who manages the organization and people-data settings (the tenant administrator).
 */
export async function groupJobs(session, log = () => {}) {
  let lists = await session.get("/api/corehr/catalog/lists");
  const familyList = () => lists.find((list) => list.id === "job-families").values;
  for (const [name] of FAMILIES) {
    if (!familyList().some((value) => value.label === name)) {
      await session.post("/api/corehr/catalog/lists/job-families/values", { label: name });
      lists = await session.get("/api/corehr/catalog/lists");
    }
  }
  const families = new Map(familyList().map((value) => [value.label, value.id]));
  const levels = new Map(lists.find((list) => list.id === "levels").values.map((value) => [value.label, value.id]));

  const jobs = await session.get("/api/corehr/catalog/jobs");
  let changed = 0;
  for (const job of jobs) {
    const familyId = families.get(familyOf(job.title)) ?? null;
    const levelId = levels.get(levelOf(job.title)) ?? null;
    if ((job.family?.id ?? null) === familyId && (job.level?.id ?? null) === levelId) continue;
    await session.put(`/api/corehr/catalog/jobs/${job.id}`, { title: job.title, familyId, levelId });
    changed++;
  }
  log(`jobs grouped: ${changed} of ${jobs.length} set, ${families.size} families`);
  return { jobs: jobs.length, changed };
}
