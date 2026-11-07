import type { CoreSearchDto, CoreSearchPersonDto, PerformanceSearchDto } from "@repo/api";
import type { AuthUser } from "../types";
import { canEnterPerformance } from "../customer-workspace-access";
import {
  canAccessCoreOrgChart,
  canAccessCoreSettings,
  canAccessCoreTeam,
  canAccessOwnCoreProfile,
  canApproveCoreChanges,
  canManageCoreEmployees,
  canProposeCoreChanges,
  canViewCoreAccessProfiles,
  canViewCoreOrganization,
  canViewCoreReports,
  hasCorePermission,
} from "../roles";

// ── The top bar search's model (B-211): pure, so the component only draws and moves ──

/** One hue per kind of thing, the same on wells, action icons and the line that names an action. */
export type SearchHue =
  | "team" | "place" | "job" | "goal" | "review" | "oneOnOne" | "report" | "chart" | "praise" | "feedback" | "change" | "hire";

export const SEARCH_HUES: Record<SearchHue, string> = {
  team: "var(--identity-2)",
  place: "var(--identity-3)",
  job: "var(--identity-1)",
  goal: "var(--primary)",
  review: "var(--identity-5)",
  oneOnOne: "var(--identity-4)",
  report: "var(--info)",
  chart: "var(--identity-2)",
  praise: "var(--identity-5)",
  feedback: "var(--info)",
  change: "var(--primary)",
  hire: "var(--success)",
};

export type SearchIcon =
  | "home" | "people" | "chart" | "user" | "team" | "place" | "job" | "goal" | "oneOnOne" | "praise" | "feedback"
  | "review" | "report" | "hire" | "settings" | "roles" | "cycle" | "changes" | "change";

/** Each icon's hue; icons without one stay neutral. */
export const ICON_HUE: Partial<Record<SearchIcon, SearchHue>> = {
  chart: "chart", team: "team", place: "place", job: "job", goal: "goal", oneOnOne: "oneOnOne", praise: "praise",
  feedback: "feedback", review: "review", report: "report", hire: "hire", cycle: "goal", changes: "change", change: "change",
};

export type PageId =
  | "home" | "people" | "orgChart" | "profile" | "team" | "changes" | "organization" | "jobs" | "places" | "reports"
  | "hire" | "roles" | "coreSettings" | "plan" | "oneOnOnes" | "feedback" | "reviews" | "teamPerformance" | "cycle"
  | "settings";

export interface SearchPage {
  id: PageId;
  href: string;
  icon: SearchIcon;
}

export interface SearchRights {
  core: boolean;
  performance: boolean;
  orgChart: boolean;
  manageEmployees: boolean;
  proposeChanges: boolean;
}

export function searchRights(user: AuthUser | null, coreEntitled: boolean, orgChart: boolean): SearchRights {
  return {
    core: coreEntitled,
    performance: canEnterPerformance(user),
    orgChart: coreEntitled && orgChart && canAccessCoreOrgChart(user),
    manageEmployees: coreEntitled && canManageCoreEmployees(user),
    proposeChanges: coreEntitled && canProposeCoreChanges(user),
  };
}

/** The pages the viewer can open, in the order they're offered. Hide, don't deny. */
export function searchPages(user: AuthUser | null, rights: SearchRights): SearchPage[] {
  const core = rights.core;
  const perf = rights.performance;
  const pages: (SearchPage | false)[] = [
    { id: "home", href: "/", icon: "home" },
    core && { id: "people", href: "/core/people", icon: "people" },
    rights.orgChart && { id: "orgChart", href: "/core/organization?view=people", icon: "chart" },
    core && canAccessOwnCoreProfile(user) && { id: "profile", href: "/core/profile", icon: "user" },
    perf && { id: "plan", href: "/performance/plan", icon: "goal" },
    perf && { id: "oneOnOnes", href: "/performance/one-on-ones", icon: "oneOnOne" },
    perf && { id: "feedback", href: "/performance/feedback", icon: "praise" },
    perf && { id: "reviews", href: "/performance/reviews", icon: "review" },
    core && canAccessCoreTeam(user) && { id: "team", href: "/core/team", icon: "team" },
    perf && hasCorePermission(user, "performance.cycle.view", "DirectReports") && { id: "teamPerformance", href: "/performance/team", icon: "goal" },
    core && (rights.proposeChanges || canApproveCoreChanges(user) || rights.manageEmployees) && { id: "changes", href: "/core/changes", icon: "changes" },
    core && canViewCoreOrganization(user) && { id: "organization", href: "/core/organization", icon: "team" },
    core && canViewCoreOrganization(user) && { id: "jobs", href: "/core/organization/jobs", icon: "job" },
    core && canViewCoreOrganization(user) && { id: "places", href: "/core/organization/places", icon: "place" },
    core && canViewCoreReports(user) && { id: "reports", href: "/core/reports", icon: "report" },
    rights.manageEmployees && { id: "hire", href: "/core/people/hire", icon: "hire" },
    core && canViewCoreAccessProfiles(user) && { id: "roles", href: "/core/settings/roles", icon: "roles" },
    core && canAccessCoreSettings(user) && { id: "coreSettings", href: "/core/settings", icon: "settings" },
    perf && hasCorePermission(user, "performance.cycle.manage", "Tenant") && { id: "cycle", href: "/performance/cycle", icon: "cycle" },
    { id: "settings", href: "/settings", icon: "settings" },
  ];
  return pages.filter((page): page is SearchPage => Boolean(page));
}

/** Offered before anything is typed. */
export const GO_TO: readonly PageId[] = ["home", "people", "orgChart", "plan"];

// ── Matching: accent- and case-insensitive, by word start (the same rule as the servers) ──

const SEPARATORS = /[\s\-,&.@/()_'’]+/;

export function fold(text: string | null | undefined): string {
  return (text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** 100 when the text starts with the query, 80 when one of its words does, 0 otherwise. */
export function score(text: string | null | undefined, query: string): number {
  const t = fold(text);
  const q = fold(query).trim();
  if (!t || !q) return 0;
  if (t.startsWith(q)) return 100;
  return t.split(SEPARATORS).some((word) => word.startsWith(q)) ? 80 : 0;
}

/** The matched part of a text, for bolding: [before, match, after], or null. */
export function highlight(text: string, query: string): [string, string, string] | null {
  const q = fold(query).trim();
  if (!q) return null;
  const at = fold(text).indexOf(q);
  if (at < 0) return null;
  return [text.slice(0, at), text.slice(at, at + q.length), text.slice(at + q.length)];
}

// ── Verbs: "praise mariam", "feedback omar", "1:1 aicha", "hire" ──

export type Verb = "praise" | "feedback" | "oneOnOne" | "hire";

/** The verb the query starts with, and the rest (who), from the viewer's language's verb words. */
export function readVerb(raw: string, words: Record<Verb, string>): { verb: Verb | null; rest: string; bare: Verb | null } {
  const q = fold(raw).trimStart();
  for (const verb of Object.keys(words) as Verb[]) {
    for (const word of fold(words[verb]).split(/\s+/).filter(Boolean)) {
      if (q.startsWith(`${word} `) && q.slice(word.length).trim()) return { verb, rest: raw.trimStart().slice(word.length).trim(), bare: null };
      if (q.trim().startsWith(word)) return { verb: null, rest: raw, bare: verb };
    }
  }
  return { verb: null, rest: raw, bare: null };
}

// ── What a row opens ──

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export interface PersonAction {
  id: "orgChart" | "praise" | "feedback" | "oneOnOne" | "change";
  hue: SearchHue;
  href: string;
}

/** What the viewer may do with a person from the search, per their rights. */
export function personActions(person: CoreSearchPersonDto, rights: SearchRights): PersonAction[] {
  const key = encodeURIComponent(person.employeeKey);
  const id = encodeURIComponent(person.employeeId);
  const self = person.relation === "Self";
  const report = person.relation === "Report";
  const actions: PersonAction[] = [];
  if (rights.orgChart) actions.push({ id: "orgChart", hue: "chart", href: `/core/organization?view=people&focus=${key}` });
  if (self) return actions;
  if (rights.performance) {
    actions.push({ id: "praise", hue: "praise", href: `/performance/feedback?compose=praise&to=${id}` });
    actions.push({ id: "feedback", hue: "feedback", href: `/performance/feedback?compose=ask&to=${id}` });
    if (report) actions.push({ id: "oneOnOne", hue: "oneOnOne", href: "/performance/one-on-ones" });
  }
  if (rights.manageEmployees || (rights.proposeChanges && report))
    actions.push({ id: "change", hue: "change", href: `/core/people/${key}?change=job` });
  return actions;
}

export const personHref = (person: Pick<CoreSearchPersonDto, "employeeKey">) => `/core/people/${encodeURIComponent(person.employeeKey)}`;

// ── Results ──

export type SearchScope = "all" | "people" | "teams" | "performance" | "pages";

/** A row: a person, or a thing with a well (team, page, objective, …), or "See all". */
export type SearchItem =
  | { kind: "person"; key: string; person: CoreSearchPersonDto; href: string }
  | {
      kind: "thing";
      key: string;
      label: string;
      sub: string;
      icon: SearchIcon;
      href: string;
      /** A 1:1 leads with the other person's face. */
      face?: { name: string; photoUrl?: string | null };
    }
  | { kind: "allPeople"; key: string; label: string; href: string };

export interface SearchGroup {
  id: "do" | "people" | "teams" | "jobs" | "performance" | "pages" | "yourPeople" | "recent" | "goTo";
  items: SearchItem[];
}

export interface SearchText {
  page: (id: PageId) => { label: string; path: string; keywords: string };
  action: (id: "givePraise" | "askFeedback" | "hire" | PersonAction["id"], name?: string) => string;
  sub: {
    team: (count: number) => string;
    place: (count: number) => string;
    job: (count: number) => string;
    objective: (scope: string, yours: boolean) => string;
    oneOnOne: string;
    reviewRound: string;
    cycle: string;
    report: string;
    chooseWho: string;
  };
  oneOnOneWith: (name: string) => string;
  seeAll: (count: number, q: string) => string;
}

export interface SearchResults {
  groups: SearchGroup[];
  counts: Record<SearchScope, number>;
}

export function pageItem(page: SearchPage, text: SearchText): SearchItem {
  const words = text.page(page.id);
  return { kind: "thing", key: `page:${page.id}`, label: words.label, sub: words.path, icon: page.icon, href: page.href };
}

/** The groups for a typed query, in the accepted order: Do, People, Teams and places, Jobs, Performance, Pages. */
export function buildResults(
  q: string,
  scope: SearchScope,
  core: CoreSearchDto | undefined,
  performance: PerformanceSearchDto | undefined,
  pages: SearchPage[],
  rights: SearchRights,
  verbWords: Record<Verb, string>,
  text: SearchText,
): SearchResults {
  const query = q.trim();
  const { verb, rest, bare } = readVerb(query, verbWords);
  const people = core?.people ?? [];
  const top = people.find((person) => person.relation !== "Self");

  const doItems: SearchItem[] = [];
  if (verb && top) {
    const name = firstName(top.displayName);
    const action = personActions(top, rights).find((a) =>
      verb === "praise" ? a.id === "praise" : verb === "feedback" ? a.id === "feedback" : verb === "oneOnOne" ? a.id === "oneOnOne" : false);
    if (action) {
      const series = performance?.oneOnOnes.find((s) => s.withEmployeeId === top.employeeId);
      doItems.push({
        kind: "thing", key: `do:${action.id}:${top.employeeKey}`, label: text.action(action.id, name), sub: top.displayName,
        icon: action.id === "orgChart" ? "chart" : action.id, href: action.id === "oneOnOne" && series ? `/performance/one-on-ones/${series.seriesId}` : action.href,
      });
    }
  }
  if (bare === "praise" && rights.performance)
    doItems.push({ kind: "thing", key: "do:praise", label: text.action("givePraise"), sub: text.sub.chooseWho, icon: "praise", href: "/performance/feedback?compose=praise" });
  if (bare === "feedback" && rights.performance)
    doItems.push({ kind: "thing", key: "do:ask", label: text.action("askFeedback"), sub: text.sub.chooseWho, icon: "feedback", href: "/performance/feedback?compose=ask" });
  if (bare === "hire" && rights.manageEmployees)
    doItems.push({ kind: "thing", key: "do:hire", label: text.action("hire"), sub: text.page("hire").path, icon: "hire", href: "/core/people/hire" });

  const peopleItems: SearchItem[] = people.map((person) => ({ kind: "person", key: `person:${person.employeeKey}`, person, href: personHref(person) }));
  const peopleTotal = core?.peopleTotal ?? 0;
  const teamItems: SearchItem[] = [
    ...(core?.units ?? []).map((unit): SearchItem => ({
      kind: "thing", key: `unit:${unit.id}`, label: unit.name, sub: text.sub.team(unit.people), icon: "team", href: `/core/people?unit=${encodeURIComponent(unit.id)}`,
    })),
    ...(core?.places ?? []).map((place): SearchItem => ({
      kind: "thing", key: `place:${place.id}`, label: place.name, sub: text.sub.place(place.people), icon: "place", href: `/core/people?place=${encodeURIComponent(place.id)}`,
    })),
  ].slice(0, 4);
  const jobItems: SearchItem[] = (core?.jobs ?? []).map((job) => ({
    kind: "thing", key: `job:${job.id}`, label: job.name, sub: text.sub.job(job.people), icon: "job", href: `/core/people?job=${encodeURIComponent(job.id)}`,
  }));
  const perfItems: SearchItem[] = query && performance ? [
    ...performance.oneOnOnes.map((s): SearchItem => ({
      kind: "thing", key: `oneOnOne:${s.seriesId}`, label: text.oneOnOneWith(s.withName), sub: text.sub.oneOnOne, icon: "oneOnOne",
      href: `/performance/one-on-ones/${s.seriesId}`, face: { name: s.withName },
    })),
    ...performance.objectives.map((o): SearchItem => ({
      kind: "thing", key: `objective:${o.id}`, label: o.title, sub: text.sub.objective(o.scope, o.yours), icon: "goal",
      href: `/performance/cycles/${o.cycleId}/objectives/${o.id}`,
    })),
    ...performance.reviewRounds.map((r): SearchItem => ({
      kind: "thing", key: `round:${r.id}`, label: r.name, sub: text.sub.reviewRound, icon: "review",
      href: r.administers ? `/performance/reviews/rounds/${r.id}` : "/performance/reviews",
    })),
    ...performance.cycles.map((c): SearchItem => ({ kind: "thing", key: `cycle:${c.id}`, label: c.name, sub: text.sub.cycle, icon: "cycle", href: "/performance/cycle" })),
  ] : [];
  const reportItems: SearchItem[] = (core?.reports ?? []).map((r) => ({
    kind: "thing", key: `report:${r.id}`, label: r.name, sub: text.sub.report, icon: "report", href: `/core/reports/${r.id}`,
  }));
  perfItems.push(...reportItems);
  const pageItems: SearchItem[] = pages
    .map((page) => {
      const words = text.page(page.id);
      const s = Math.max(score(words.label, query), score(words.path, query), words.keywords.split(/\s+/).some((k) => score(k, query)) ? 60 : 0);
      return { page, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 5)
    .map((x) => pageItem(x.page, text));

  const counts: Record<SearchScope, number> = {
    all: 0,
    people: peopleTotal,
    teams: teamItems.length + jobItems.length,
    performance: perfItems.length,
    pages: pageItems.length + doItems.length,
  };
  counts.all = counts.people + counts.teams + counts.performance + counts.pages;

  const S = (s: SearchScope) => scope === "all" || scope === s;
  const groups: SearchGroup[] = [];
  if (S("pages") && doItems.length) groups.push({ id: "do", items: doItems });
  if (S("people") && peopleItems.length) {
    const shown = peopleItems.slice(0, scope === "people" ? 20 : 5);
    if (scope === "all" && peopleTotal > shown.length)
      shown.push({ kind: "allPeople", key: "all-people", label: text.seeAll(peopleTotal, query), href: `/core/people?q=${encodeURIComponent(verb ? rest : query)}` });
    groups.push({ id: "people", items: shown });
  }
  if (S("teams") && teamItems.length) groups.push({ id: "teams", items: teamItems });
  if (S("teams") && jobItems.length) groups.push({ id: "jobs", items: jobItems });
  if (S("performance") && perfItems.length) groups.push({ id: "performance", items: perfItems.slice(0, 5) });
  if (S("pages") && pageItems.length) groups.push({ id: "pages", items: pageItems });
  return { groups, counts };
}

// ── Recent: on the device, per person and company ──

export type RecentItem =
  | { kind: "person"; person: CoreSearchPersonDto }
  | { kind: "thing"; label: string; sub: string; icon: SearchIcon; href: string; face?: { name: string } };

const RECENT_LIMIT = 3;

export const recentStorageKey = (tenantId: string, userId: string) => `fusion:search-recent:${tenantId}:${userId}`;

export function readRecent(storage: Storage | null, key: string): RecentItem[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? (parsed as RecentItem[]).slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

export function rememberRecent(storage: Storage | null, key: string, item: SearchItem): void {
  if (item.kind === "allPeople") return;
  const recent: RecentItem = item.kind === "person"
    ? { kind: "person", person: item.person }
    : { kind: "thing", label: item.label, sub: item.sub, icon: item.icon, href: item.href, face: item.face };
  const id = (r: RecentItem) => (r.kind === "person" ? `p:${r.person.employeeKey}` : `t:${r.href}:${r.label}`);
  const next = [recent, ...readRecent(storage, key).filter((r) => id(r) !== id(recent))].slice(0, RECENT_LIMIT);
  try {
    storage?.setItem(key, JSON.stringify(next));
  } catch {
    // Storage full or blocked: recent just doesn't update.
  }
}

export function recentItem(recent: RecentItem): SearchItem {
  return recent.kind === "person"
    ? { kind: "person", key: `recent:person:${recent.person.employeeKey}`, person: recent.person, href: personHref(recent.person) }
    : { kind: "thing", key: `recent:${recent.href}:${recent.label}`, label: recent.label, sub: recent.sub, icon: recent.icon, href: recent.href, face: recent.face };
}
