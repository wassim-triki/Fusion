import type { ApiClient } from "./types";

export type ChecklistKind = "joining" | "leaving";
/** Who does a task: HR, the person's manager, or the person themselves. */
export type ChecklistOwner = "hr" | "manager" | "person";

/** `offsetDays` counts from the first day (joining) or the last day (leaving); negative is before. */
export interface ChecklistTemplateTaskDto {
  id: string;
  title: string;
  owner: ChecklistOwner;
  offsetDays: number;
}

export interface ChecklistTemplatesDto {
  joining: ChecklistTemplateTaskDto[];
  leaving: ChecklistTemplateTaskDto[];
}

export interface ChecklistTemplateTaskInput {
  title: string;
  owner: ChecklistOwner;
  offsetDays: number;
}

/** `doneBy` and `doneAt` say who ticked it and when; `canComplete` is whether the viewer may tick it. */
export interface ChecklistTaskDto {
  id: string;
  title: string;
  owner: ChecklistOwner;
  dueDate: string;
  doneAt: string | null;
  doneBy: string | null;
  canComplete: boolean;
}

/** A person's checklist with only the tasks the viewer may see. `day` is the first or last day. */
export interface ChecklistDto {
  id: string;
  kind: "Joining" | "Leaving";
  day: string;
  tasks: ChecklistTaskDto[];
}

export interface BirthdaySharingDto {
  share: boolean;
  hasDate: boolean;
}

export const coreChecklistPaths = {
  templates: () => "/corehr/checklists/templates",
  template: (kind: ChecklistKind) => `/corehr/checklists/templates/${kind}`,
  person: (employeeKey: string) => `/corehr/people/${encodeURIComponent(employeeKey)}/checklists`,
  task: (id: string) => `/corehr/checklists/tasks/${encodeURIComponent(id)}`,
  birthday: () => "/corehr/me/birthday",
} as const;

export const coreChecklistQueryKeys = {
  all: () => ["core-checklists"] as const,
  templates: () => [...coreChecklistQueryKeys.all(), "templates"] as const,
  person: (employeeKey: string) => [...coreChecklistQueryKeys.all(), "person", employeeKey] as const,
  birthday: () => [...coreChecklistQueryKeys.all(), "birthday"] as const,
};

/** Joining and leaving checklists and the caller's birthday choice (`/api/corehr`, B-184). */
export function createCoreChecklistsApi(client: ApiClient) {
  return {
    templates: (signal?: AbortSignal) => client.get<ChecklistTemplatesDto>(coreChecklistPaths.templates(), { signal }),
    saveTemplate: (kind: ChecklistKind, tasks: ChecklistTemplateTaskInput[]) =>
      client.put<ChecklistTemplatesDto>(coreChecklistPaths.template(kind), { tasks }),
    person: (employeeKey: string, signal?: AbortSignal) => client.get<ChecklistDto[]>(coreChecklistPaths.person(employeeKey), { signal }),
    setDone: (taskId: string, done: boolean) => client.put<ChecklistTaskDto>(coreChecklistPaths.task(taskId), { done }),
    birthday: (signal?: AbortSignal) => client.get<BirthdaySharingDto>(coreChecklistPaths.birthday(), { signal }),
    setBirthday: (share: boolean) => client.put<BirthdaySharingDto>(coreChecklistPaths.birthday(), { share }),
  };
}
