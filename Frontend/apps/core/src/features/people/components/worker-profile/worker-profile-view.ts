import type { StatusTone } from "@repo/ds/shell";
import type {
  PeopleAccessStatusDto,
  PeopleProfileDto,
  PeopleProfileEmploymentDto,
  PeopleTimelineEventDto,
} from "@repo/api";
import { englishSay, type Say } from "@repo/ds/lib/say";
import { englishMessages } from "@/i18n/messages";
import { formatWorkforceDate } from "../workforce-ui";

/**
 * The person page's view model (B-180): one shape for `/core/profile` and `/core/people/{employeeKey}`, both read from
 * the People snapshot. Business data comes from Core workforce truth; the viewer's capabilities and relationship to
 * the subject are expressed by the container through the surface's slots, never baked into this model.
 */
export interface WorkerProfileManager {
  name: string;
  employeeKey: string;
  /** Root-relative profile href (basePath `/core` is applied by Next). */
  href: string;
  email?: string | null;
  employeeNumber?: string | null;
  photoUrl?: string | null;
}

export interface WorkerProfileReport {
  name: string;
  href: string;
  jobTitle?: string | null;
  photoUrl?: string | null;
}

export interface WorkerProfileAccess {
  label: string;
  tone: StatusTone;
  /** People projection: one authoritative detail line. */
  detail?: string | null;
}

export interface WorkerProfileView {
  employeeKey: string;
  displayName: string;
  /** API-relative, versioned; null without a photo. */
  photoUrl: string | null;
  employeeNumber: string | null;
  status: { label: string; tone: StatusTone };

  jobTitle: string | null;
  /** The job's family and level from the company's catalogue (B-195). */
  jobFamily: string | null;
  jobLevel: string | null;
  orgUnitName: string | null;
  /** Full org path, for the unit's parent in the band. */
  orgUnitPath: string | null;
  workLocation: string | null;
  assignmentEffectiveFrom: string | null;
  /** Work details genuinely unavailable on this date — never invented. */
  workUnavailable: boolean;

  employmentType: string | null;
  employmentStart: string | null;
  /** Human employment line ("Since …" / "Starts …" / "Ended …"); People only. */
  employmentLine: string | null;

  workEmail: string | null;
  phone: string | null;

  manager: WorkerProfileManager | null;
  directReports: WorkerProfileReport[];
  directReportCount: number;

  access: WorkerProfileAccess | null;

  timeline: PeopleTimelineEventDto[];

  /** Viewing a non-Today snapshot (People temporal); the snapshot is read-only. */
  isAsOf: boolean;
  viewedDate: string | null;
}

/** Shared tone mapping for Fusion account/access states. */
export const ACCESS_TONE: Record<string, StatusTone> = {
  Active: "success",
  Suspended: "warning",
  NeedsReview: "warning",
  InvitationPending: "info",
  NoAccess: "muted",
};

/** How the view model words things: the `profile` namespace and the language for dates. English by default. */
export interface ProfileWords {
  say: Say;
  locale?: string;
}

const ENGLISH: ProfileWords = { say: englishSay(englishMessages, "profile") };

const EMPLOYMENT_TYPES = new Set(["FullTime", "PartTime", "Contract", "Contractor", "Intern", "Temporary", "Seasonal"]);

/** Humanize an employment-type enum for display; passes through already-humanized values. */
export function formatEmploymentType(value: string | null | undefined, words: ProfileWords = ENGLISH): string {
  if (!value) return words.say("employmentType.notSet");
  return EMPLOYMENT_TYPES.has(value)
    ? words.say(`employmentType.${value}`)
    : value.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** A Fusion access state in words; an unknown state keeps the server's label. */
function accessLabel(state: string, label: string, say: Say): string {
  return state in ACCESS_TONE ? say(`access.${state}`) : label;
}

/** The People employment state expressed as a plain human line. */
function employmentLine(employment: PeopleProfileEmploymentDto, { say, locale }: ProfileWords): string {
  const { state, start, end } = employment;
  const long = (value: string) => formatWorkforceDate(value, { month: "long", locale });
  if (state === "Scheduled")
    return start ? say("line.starts", { date: long(start) }) : say("line.startsLater");
  if (state === "Former") {
    if (start && end) return say("line.period", { start: long(start), end: long(end) });
    return end ? say("line.ended", { date: long(end) }) : say("line.employmentEnded");
  }
  if (state === "Incomplete") return say("line.notEmployed");
  return start ? say("line.since", { date: long(start) }) : say("line.active");
}

const PEOPLE_STATE_TONE: Record<string, StatusTone> = {
  Active: "success",
  Scheduled: "info",
  Former: "muted",
  Incomplete: "warning",
};

/**
 * Normalize another worker's temporal People snapshot into the shared view.
 * Carries the as-of/upcoming machinery and org ancestry the People read owns.
 */
export function fromPeopleProfile(
  profile: PeopleProfileDto,
  timeline: PeopleTimelineEventDto[] | undefined,
  access: PeopleAccessStatusDto | null,
  words: ProfileWords = ENGLISH
): WorkerProfileView {
  const { identity, employment, work, primaryManager } = profile;
  const { say } = words;

  return {
    employeeKey: identity.employeeKey,
    displayName: identity.displayName,
    photoUrl: identity.photoUrl,
    employeeNumber: identity.employeeNumber,
    status: {
      label: employment.state in PEOPLE_STATE_TONE ? say(`status.${employment.state}`) : employment.state,
      tone: PEOPLE_STATE_TONE[employment.state] ?? "muted",
    },

    jobTitle: work?.jobTitle ?? null,
    jobFamily: work?.jobFamily ?? null,
    jobLevel: work?.jobLevel ?? null,
    orgUnitName: work?.organizationName ?? null,
    orgUnitPath: work?.organizationPath ?? null,
    workLocation: work?.location ?? null,
    assignmentEffectiveFrom: work?.effectiveFrom ?? null,
    workUnavailable: !work,

    employmentType: employment.employmentType,
    employmentStart: employment.start,
    employmentLine: employmentLine(employment, words),

    workEmail: identity.workEmail,
    phone: identity.phone,

    manager: primaryManager
      ? {
          name: primaryManager.displayName,
          employeeKey: primaryManager.employeeKey,
          href: `/people/${primaryManager.employeeKey}`,
          employeeNumber: primaryManager.employeeNumber,
          photoUrl: primaryManager.photoUrl ?? null,
        }
      : null,
    directReports: reportsOf(profile),
    directReportCount: profile.directReportCount,

    access: access
      ? {
          label: accessLabel(access.state, access.label, say),
          tone: ACCESS_TONE[access.state] ?? "muted",
          detail: access.detail,
        }
      : null,

    timeline: timeline ?? [],

    isAsOf: profile.isAsOf,
    viewedDate: profile.viewedDate,
  };
}

function reportsOf(profile: PeopleProfileDto): WorkerProfileReport[] {
  return profile.directReports.map((report) => ({
    name: report.displayName,
    href: `/people/${report.employeeKey}`,
    jobTitle: report.jobTitle,
    photoUrl: report.photoUrl ?? null,
  }));
}

/** Whole years, months and days from `from` (yyyy-mm-dd…) to `to`; null for a future or missing date. */
export function tenure(from: string | null | undefined, to: Date = new Date()): { years: number; months: number; days: number } | null {
  if (!from) return null;
  const [y, m, d] = from.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  let years = to.getFullYear() - y;
  let months = to.getMonth() + 1 - m;
  let days = to.getDate() - d;
  if (days < 0) {
    months -= 1;
    days += new Date(to.getFullYear(), to.getMonth(), 0).getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return years < 0 ? null : { years, months, days };
}
