import type { ApiClient } from "./types";
import type { CompanyWorkWeekDto } from "./tenant-settings";

/** As any colleague sees them in the directory; never contact details. */
export interface MyManagerCardDto {
  employeeKey: string;
  displayName: string;
  jobTitle: string | null;
  photoUrl: string | null;
  unit: string | null;
  place: string | null;
}
export interface MyTeammateDto {
  employeeKey: string;
  displayName: string;
  jobTitle: string | null;
  photoUrl: string | null;
}
export interface MyManagerDto {
  manager: MyManagerCardDto | null;
  isFirstWeek: boolean;
  /** Filled only during the first week: up to three, plus how many in all. */
  teammates: MyTeammateDto[];
  teammateCount: number;
}

export const companyHomeKeys = {
  workWeek: (tenantId: string) => ["company-work-week", tenantId] as const,
  manager: (tenantId: string, userId: string) => ["my-manager", tenantId, userId] as const,
  administrators: (tenantId: string) => ["company-administrators", tenantId] as const,
};

export function createCompanyHomeApi(client: ApiClient) {
  return {
    workWeek: (signal?: AbortSignal) => client.get<CompanyWorkWeekDto>("/corehr/settings/work-week", { signal }),
    manager: (signal?: AbortSignal) => client.get<MyManagerDto>("/corehr/me/manager", { signal }),
    administrators: (signal?: AbortSignal) =>
      client.get<CompanyAdministratorsDto>("/identity/tenant-context/administrators", { signal }),
  };
}

/** Compact contiguous weeks, explicit lists for split weeks. Uses the viewer's language. */
export function formatWorkWeek(days: readonly number[], locale: string): string {
  const sorted = [...days].sort((a, b) => a - b);
  const format = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  const day = (value: number) => format.format(new Date(Date.UTC(2026, 0, 4 + value)));
  if (sorted.length > 1 && sorted.every((value, index) => index === 0 || value === sorted[index - 1]! + 1))
    return `${day(sorted[0]!)}–${day(sorted[sorted.length - 1]!)}`;
  return new Intl.ListFormat(locale, { style: "short", type: "conjunction" }).format(sorted.map(day));
}

/** Someone who can give a person access; a refused page names them (B-302). */
export interface CompanyAdministratorContactDto {
  name: string;
  firstName: string;
  email: string;
}
export interface CompanyAdministratorsDto {
  /** An administrator gets no names: a refusal never tells them to ask themselves. */
  callerIsAdministrator: boolean;
  administrators: CompanyAdministratorContactDto[];
}
