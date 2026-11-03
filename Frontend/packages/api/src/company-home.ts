import type { ApiClient } from "./types";
import type { CompanyWorkWeekDto } from "./tenant-settings";

export interface MyManagerDto {
  manager: { displayName: string; jobTitle: string | null } | null;
  isFirstWeek: boolean;
}

export const companyHomeKeys = {
  workWeek: (tenantId: string) => ["company-work-week", tenantId] as const,
  manager: (tenantId: string, userId: string) => ["my-manager", tenantId, userId] as const,
};

export function createCompanyHomeApi(client: ApiClient) {
  return {
    workWeek: (signal?: AbortSignal) => client.get<CompanyWorkWeekDto>("/corehr/settings/work-week", { signal }),
    manager: (signal?: AbortSignal) => client.get<MyManagerDto>("/corehr/me/manager", { signal }),
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
