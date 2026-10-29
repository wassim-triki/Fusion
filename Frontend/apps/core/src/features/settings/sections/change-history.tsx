"use client";

import { useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { ChevronRight } from "lucide-react";
import type { AccessAuditEventDto, AccessProfileSummaryDto, FusionSettingsSection, SettingsAuditEventDto } from "@repo/api";
import { cn, NativeSelect, NativeSelectOption } from "@repo/ds";
import { formatDate, formatDateParts, formatTime } from "@repo/ds/lib/dates";
import { PageError, SettingsPage, useSettingsSectionName } from "@repo/ds/shell";
import { useAccessAudit } from "@/features/settings/api/use-core-access";
import { useSettingsAudit } from "@/features/settings/api/use-tenant-settings";
import { AUDIT_SECTION_IDS } from "@/features/settings/core-settings";
import { sayInEnglish, useSettingsSay, type Say } from "@/features/settings/say";
import { levelsOf, ROLE_AREAS } from "@/features/settings/sections/roles";

/** The profile fields Employee fields names (`employeeFields.fields.<key>.label`). */
const FIELDS = new Set(["firstName", "lastName", "email", "hireDate", "phone", "jobTitle", "workLocation", "employmentType"]);

/** The audiences a field's visibility is set for (`changeHistory.audience.<key>`). */
const AUDIENCES = new Set(["visibleToManager", "visibleToEmployee"]);

/** One before → after line of a change, in the words its page uses. */
export interface ChangeLine {
  label: string;
  before: string;
  after: string;
  /** The change as a sentence, for the entry's headline. */
  sentence: string;
}

export interface HistoryEntry {
  id: string;
  at: Date;
  /** Null when the module couldn't name who made the change. */
  actor: string | null;
  /** The settings section's id, or the audit's own when Settings has no section for it. */
  section: string;
  headline: string;
  lines: ChangeLine[];
}

function flatten(value: unknown, prefix = "", into: Record<string, unknown> = {}): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, into);
  } else if (prefix) {
    into[prefix] = value;
  }
  return into;
}

function parse(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

const IGNORED = /(^|\.)(version|downstreamConsumers|usesDefaultBranding|displayName|locale|timeZone|visible)$/;

/** A changed value, described the way Settings shows it. */
export function describeChange(path: string, before: unknown, after: unknown, say: Say = sayInEnglish): ChangeLine {
  const said = (key: string, values?: Record<string, string | number>) => say(`changeHistory.${key}`, values);
  const field = /employeeFieldConfig\.(\w+)\.(\w+)$/.exec(path);
  if (field) {
    const name = FIELDS.has(field[1]!) ? say(`employeeFields.fields.${field[1]}.label`) : field[1]!;
    if (AUDIENCES.has(field[2]!)) {
      const audience = { label: said(`audience.${field[2]}.label`), who: said(`audience.${field[2]}.who`) };
      const seen = (value: unknown) => said(value ? "seesIt" : "hidden");
      return {
        label: said("fieldAudience", { field: name, audience: audience.label }),
        before: seen(before),
        after: seen(after),
        sentence: said(after ? "nowSee" : "noLongerSee", { field: name, who: audience.who }),
      };
    }
    if (field[2] === "required") {
      const yes = (value: unknown) => said(value ? "required" : "optional");
      return {
        label: said("requiredLabel", { field: name }),
        before: yes(before),
        after: yes(after),
        sentence: said(after ? "nowRequired" : "nowOptional", { field: name }),
      };
    }
  }
  const self = /selfService\.canEdit(\w+)$/.exec(path);
  if (self) {
    const their = said(`selfNouns.${self[1] === "Phone" ? "Phone" : "PreferredName"}`);
    const can = (value: unknown) => said(value ? "yes" : "no");
    return {
      label: said("selfLabel", { their }),
      before: can(before),
      after: can(after),
      sentence: said(after ? "selfCan" : "selfCannot", { their }),
    };
  }
  if (path.endsWith("orgChart.audience")) {
    const audience = (value: unknown) => (value === "ManagersAndHr" ? "ManagersAndHr" : "Everyone");
    return {
      label: say("employeeFields.orgChart.title"),
      before: say(`employeeFields.orgChart.${audience(before)}.label`),
      after: say(`employeeFields.orgChart.${audience(after)}.label`),
      sentence: say(`employeeFields.consequence.orgChart${audience(after)}`),
    };
  }
  const count = (value: unknown) => (typeof value === "number" ? value : Number(value));
  if (path.endsWith("inviteExpiryDays"))
    return {
      label: said("expiryLabel"),
      before: said("days", { count: count(before) }),
      after: said("days", { count: count(after) }),
      sentence: said("expirySentence", { before: String(before), after: String(after) }),
    };
  if (path.endsWith("resendCooldownHours"))
    return {
      label: said("cooldownLabel"),
      before: said("hours", { count: count(before) }),
      after: said("hours", { count: count(after) }),
      sentence: said("cooldownSentence", { before: String(before), after: String(after) }),
    };
  if (path.endsWith("pendingInviteBehavior")) {
    const name = (value: unknown) => said(value === "KeepExisting" ? "keep" : "fresh");
    const choice = name(after);
    return {
      label: said("reinviteLabel"),
      before: name(before),
      after: choice,
      sentence: said("reinviteSentence", { choice: choice.charAt(0).toLowerCase() + choice.slice(1) }),
    };
  }
  if (path === "team-and-job-changes") {
    const mode = (value: unknown) => said(`mode.${value === "required" || value === "off" ? value : "on"}`);
    return {
      label: said("notificationLabel"),
      before: mode(before),
      after: mode(after),
      sentence: said("notificationSentence", { mode: mode(after) }),
    };
  }
  if (path.endsWith("defaultAccessProfileId")) {
    const role = (value: unknown) => said(value ? "chosenRole" : "defaultRole");
    return { label: said("roleLabel"), before: role(before), after: role(after), sentence: said("roleSentence") };
  }
  const text = (value: unknown) => (value === null || value === undefined || value === "" ? said("none") : String(value));
  const name = path.split(".").pop() ?? path;
  return { label: name, before: text(before), after: text(after), sentence: said("otherSentence", { name }) };
}

/** The values a settings entry changed, as lines. */
export function changeLines(beforeJson: string | null, afterJson: string | null, say: Say = sayInEnglish): ChangeLine[] {
  const before = flatten(parse(beforeJson));
  const after = flatten(parse(afterJson));
  return Object.keys({ ...before, ...after })
    .filter((path) => !IGNORED.test(path) && JSON.stringify(before[path]) !== JSON.stringify(after[path]))
    .map((path) => describeChange(path, before[path], after[path], say));
}

function actorOf(name: string | null | undefined): string | null {
  return name && name !== "Unknown" ? name : null;
}

/**
 * A settings change as an entry. Without lines it falls back to the audit's summary, which the service writes in
 * English: other languages say a plain "Changed settings" instead.
 */
function fromSettings(entry: SettingsAuditEventDto, say: Say, english: boolean): HistoryEntry {
  const lines = changeLines(entry.beforeJson, entry.afterJson, say);
  return {
    id: `settings:${entry.id}`,
    at: new Date(entry.occurredAt),
    actor: actorOf(entry.actorName),
    section: AUDIT_SECTION_IDS[entry.sectionId] ?? entry.sectionId,
    headline: lines[0]
      ? lines.length > 1
        ? say("changeHistory.andMore", { sentence: lines[0].sentence, count: lines.length - 1 })
        : lines[0].sentence
      : english
        ? entry.summary
        : say("changeHistory.settingsChange"),
    lines,
  };
}

/** A person's roles as Identity's audit records them (`UserAccessAssignmentDto`). */
interface Holder {
  userId?: string;
  fullName?: string | null;
  email?: string;
  accessProfiles?: { id: string; name: string }[];
}

/** A role as Identity's audit records it (`AccessProfileSummaryDto`). */
interface RoleRecord {
  name?: string;
  grants?: { permissionKey: string }[];
}

const AREAS = ROLE_AREAS.flatMap((group) => group.areas);

function headlineOf(lines: ChangeLine[], say: Say): string {
  const first = lines[0]!.sentence;
  return lines.length > 1 ? say("changeHistory.andMore", { sentence: first, count: lines.length - 1 }) : first;
}

function holdersOf(value: unknown): Holder[] {
  if (Array.isArray(value)) return value as Holder[];
  return value && typeof value === "object" ? [value as Holder] : [];
}

/** Who gained or lost which role, one line per role. */
function assignmentLines(before: unknown, after: unknown, say: Say): ChangeLine[] {
  const said = (key: string, values?: Record<string, string | number>) => say(`changeHistory.roles.${key}`, values);
  const earlier = new Map(holdersOf(before).map((holder) => [holder.userId, holder]));
  return holdersOf(after).flatMap((holder) => {
    const person = holder.fullName || holder.email || said("someone");
    const had = earlier.get(holder.userId)?.accessProfiles ?? [];
    const has = holder.accessProfiles ?? [];
    const line = (role: string, gained: boolean): ChangeLine => ({
      label: `${person} · ${role}`,
      before: said(gained ? "notHeld" : "held"),
      after: said(gained ? "held" : "notHeld"),
      sentence: said(gained ? "gave" : "took", { person, role }),
    });
    return [
      ...has.filter((role) => !had.some((old) => old.id === role.id)).map((role) => line(role.name, true)),
      ...had.filter((role) => !has.some((now) => now.id === role.id)).map((role) => line(role.name, false)),
    ];
  });
}

/** What a role can do in each Roles area, as lines from one set of grants to another. */
function grantLines(role: string, before: RoleRecord | null, after: RoleRecord | null, say: Say): ChangeLine[] {
  const was = levelsOf({ grants: (before?.grants ?? []) as AccessProfileSummaryDto["grants"] });
  const is = levelsOf({ grants: (after?.grants ?? []) as AccessProfileSummaryDto["grants"] });
  return AREAS.filter((area) => was[area.id] !== is[area.id]).map((area) => ({
    label: say(`roles.areas.${area.id}.label`),
    before: say(`roles.levels.${was[area.id]}`),
    after: say(`roles.levels.${is[area.id]}`),
    sentence: say(`changeHistory.roles.can${is[area.id]}`, { role, what: say(`roles.areas.${area.id}.what`) }),
  }));
}

/**
 * A role change as a headline and lines, from the before and after Identity records. Null when the action or its
 * records aren't ones it knows, so the entry keeps the plain fallback.
 */
export function roleChange(
  action: string,
  beforeJson: string | null,
  afterJson: string | null,
  say: Say = sayInEnglish
): { headline: string; lines: ChangeLine[] } | null {
  const said = (key: string, values?: Record<string, string | number>) => say(`changeHistory.roles.${key}`, values);
  const before = parse(beforeJson);
  const after = parse(afterJson);
  if (action === "access.assignment.updated" || action === "access.assignment.bulkUpdated") {
    const lines = assignmentLines(before, after, say);
    return lines.length ? { headline: headlineOf(lines, say), lines } : null;
  }
  const was = before && typeof before === "object" ? (before as RoleRecord) : null;
  const is = after && typeof after === "object" ? (after as RoleRecord) : null;
  if (action === "access.profile.created" && is?.name)
    return { headline: said("created", { role: is.name }), lines: grantLines(is.name, null, is, say) };
  if (action === "access.profile.deleted" && was?.name) return { headline: said("deleted", { role: was.name }), lines: [] };
  if (action === "access.profile.updated" && was?.name && is?.name) {
    const lines = [
      ...(was.name !== is.name
        ? [{ label: said("name"), before: was.name, after: is.name, sentence: said("renamed", { before: was.name, after: is.name }) }]
        : []),
      ...grantLines(is.name, was, is, say),
    ];
    if (lines.length) return { headline: headlineOf(lines, say), lines };
    const keys = (role: RoleRecord) => JSON.stringify((role.grants ?? []).map((grant) => grant.permissionKey).sort());
    return { headline: said(keys(was) !== keys(is) ? "changedWhat" : "changed", { role: is.name }), lines: [] };
  }
  return null;
}

/** A role change as sentences; Identity's own wording in English, a plain line otherwise, when it can't be read. */
function fromAccess(entry: AccessAuditEventDto, say: Say, english: boolean): HistoryEntry {
  const change = roleChange(entry.action, entry.beforeJson, entry.afterJson, say);
  return {
    id: `access:${entry.id}`,
    at: new Date(entry.occurredAt),
    actor: actorOf(entry.actorName),
    section: "roles",
    headline: change?.headline ?? (english ? entry.summary : say("changeHistory.roleChange")),
    lines: change?.lines ?? [],
  };
}

/** The access log also records invitations and administrators; Roles shows role definitions and who holds them. */
export function isRoleChange(entry: Pick<AccessAuditEventDto, "action">): boolean {
  return /^access\.(profile|assignment)\./.test(entry.action);
}

/** The week's period key; every other period is named by its month. */
const THIS_WEEK = "this-week";

/** "This week", then each month ("October", "October 2025" outside this year), newest first. */
export function periodOf(at: Date, now: Date = new Date(), say: Say = sayInEnglish, locale?: string): string {
  if (now.getTime() - at.getTime() < 7 * 86_400_000) return say("changeHistory.thisWeek");
  return monthOf(at, now, locale);
}

function monthOf(at: Date, now: Date, locale?: string): string {
  const name = formatDateParts(at, { month: "long" }, "–", locale);
  const month = name.charAt(0).toUpperCase() + name.slice(1);
  return at.getFullYear() === now.getFullYear() ? month : `${month} ${at.getFullYear()}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts.length > 1 ? `${parts[0]![0]}${parts[parts.length - 1]![0]}` : (parts[0] ?? "").slice(0, 2)) || "?").toUpperCase();
}

function Entry({ entry, thisWeek }: { entry: HistoryEntry; thisWeek: boolean }) {
  const say = useSettingsSay();
  const locale = useLocale();
  const sectionName = useSettingsSectionName();
  const [open, setOpen] = useState(false);
  const openable = entry.lines.length > 0;
  const actor = entry.actor ?? say("changeHistory.someone");
  const when = thisWeek
    ? `${formatDate(entry.at, { weekday: true, locale }).split(" ")[0]} ${formatTime(entry.at, "–", locale)}`
    : formatDate(entry.at, { locale });
  const body = (
    <>
      <span className="w-[72px] shrink-0 whitespace-nowrap pt-0.5 type-meta tabular-nums text-muted-foreground">{when}</span>
      <span
        aria-hidden
        className="grid size-7 shrink-0 place-items-center rounded-full bg-inlay text-[10px] font-semibold text-foreground/85 ring-1 ring-border"
      >
        {initials(actor)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="type-label font-semibold text-foreground">{actor}</span>
          <span className="rounded-control bg-inlay px-1.5 py-0.5 type-meta text-muted-foreground">
            {sectionName({ id: entry.section, label: entry.section })}
          </span>
        </span>
        <span className="text-sm text-foreground/90">{entry.headline}</span>
        {open ? (
          <span className="mt-1 flex flex-col gap-1">
            {entry.lines.map((line) => (
              <span key={line.label} className="flex flex-wrap items-baseline gap-2 type-meta">
                <span className="text-muted-foreground">{line.label}</span>
                <span className="text-muted-foreground line-through">{line.before}</span>
                <span aria-hidden className="text-muted-foreground">→</span>
                <span className="sr-only">{say("changeHistory.changedTo")}</span>
                <span className="font-semibold text-foreground">{line.after}</span>
              </span>
            ))}
          </span>
        ) : null}
      </span>
      {openable ? (
        <ChevronRight aria-hidden className={cn("mt-1 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
      ) : null}
    </>
  );
  return (
    <li>
      {openable ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className={cn(
            "flex w-full items-start gap-3 rounded-surface px-4 py-3 text-start outline-none transition-colors hover:bg-card focus-visible:ring-2 focus-visible:ring-ring",
            open && "bg-card"
          )}
        >
          {body}
        </button>
      ) : (
        <div className="flex items-start gap-3 px-4 py-3">{body}</div>
      )}
    </li>
  );
}

/** Settings › Change history: every Core HR settings change, newest first. Read-only for everyone. */
export function ChangeHistorySettings({ section }: { section: FusionSettingsSection }) {
  const say = useSettingsSay();
  const locale = useLocale();
  const sectionName = useSettingsSectionName();
  const title = sectionName(section);
  const settings = useSettingsAudit();
  const access = useAccessAudit();
  const [sectionFilter, setSectionFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");

  const english = locale === "en";
  const entries = useMemo(
    () =>
      [
        ...(settings.data ?? []).map((entry) => fromSettings(entry, say, english)),
        ...(access.data ?? []).filter(isRoleChange).map((entry) => fromAccess(entry, say, english)),
      ].sort((a, b) => b.at.getTime() - a.at.getTime()),
    [settings.data, access.data, say, english]
  );
  const name = (id: string) => sectionName({ id, label: id });
  const actorName = (entry: HistoryEntry) => entry.actor ?? say("changeHistory.someone");
  const sections = [...new Set(entries.map((entry) => entry.section))].sort((a, b) => name(a).localeCompare(name(b), locale));
  const actors = [...new Set(entries.map(actorName))].sort((a, b) => a.localeCompare(b, locale));
  const shown = entries.filter(
    (entry) => (!sectionFilter || entry.section === sectionFilter) && (!actorFilter || actorName(entry) === actorFilter)
  );
  const now = new Date();
  const periods = shown.reduce<{ key: string; period: string; entries: HistoryEntry[] }[]>((groups, entry) => {
    const thisWeek = now.getTime() - entry.at.getTime() < 7 * 86_400_000;
    const key = thisWeek ? THIS_WEEK : `${entry.at.getFullYear()}-${entry.at.getMonth()}`;
    const last = groups[groups.length - 1];
    if (last?.key === key) last.entries.push(entry);
    else groups.push({ key, period: periodOf(entry.at, now, say, locale), entries: [entry] });
    return groups;
  }, []);

  if (settings.error && !settings.data) {
    return (
      <SettingsPage title={title}>
        <PageError title={say("changeHistory.didNotLoad")} onRetry={() => void settings.refetch()} />
      </SettingsPage>
    );
  }

  return (
    <SettingsPage title={title} loading={settings.isLoading}>
      <div className="flex flex-wrap gap-2">
        <NativeSelect
          aria-label={say("changeHistory.section")}
          value={sectionFilter}
          onChange={(event) => setSectionFilter(event.target.value)}
          size="sm"
        >
          <NativeSelectOption value="">{say("changeHistory.allSections")}</NativeSelectOption>
          {sections.map((id) => (
            <NativeSelectOption key={id} value={id}>
              {name(id)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={say("changeHistory.person")}
          value={actorFilter}
          onChange={(event) => setActorFilter(event.target.value)}
          size="sm"
        >
          <NativeSelectOption value="">{say("changeHistory.anyone")}</NativeSelectOption>
          {actors.map((name) => (
            <NativeSelectOption key={name} value={name}>
              {name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      {entries.length === 0 ? (
        <p className="type-body-secondary text-muted-foreground">{say("changeHistory.empty")}</p>
      ) : shown.length === 0 ? (
        <p className="type-body-secondary text-muted-foreground">
          {say("changeHistory.noMatch")}{" "}
          <button
            type="button"
            className="font-semibold text-foreground hover:underline"
            onClick={() => {
              setSectionFilter("");
              setActorFilter("");
            }}
          >
            {say("changeHistory.clearFilters")}
          </button>
        </p>
      ) : (
        periods.map((group) => (
          <section key={group.key} aria-label={group.period} className="flex flex-col gap-1">
            <h2 className="type-subsection-title">{group.period}</h2>
            <ul className="-mx-4 flex flex-col">
              {group.entries.map((entry) => (
                <Entry key={entry.id} entry={entry} thisWeek={group.key === THIS_WEEK} />
              ))}
            </ul>
          </section>
        ))
      )}
    </SettingsPage>
  );
}
