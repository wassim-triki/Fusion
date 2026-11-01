import type { ApiClient } from "./types";

export type TeamEventKind = "Joins" | "MovesIn" | "Leaves" | "MovesOut" | "NewJob" | "Anniversary" | "Birthday";

/** `joinsOn` is set for someone who joins the team later; `startedOn` is their first day with the company. */
export interface TeamPersonDto {
  employeeId: string;
  employeeKey: string;
  displayName: string;
  jobTitle: string | null;
  place: string | null;
  photoUrl: string | null;
  startedOn: string | null;
  joinsOn: string | null;
}

/** Something in the team's next 30 days: `years` for an anniversary, `jobTitle` for a new job. */
export interface TeamEventDto {
  kind: TeamEventKind;
  date: string;
  employeeKey: string;
  years: number | null;
  jobTitle: string | null;
}

export interface TeamOpenRoleDto {
  id: string;
  jobTitle: string;
  placeName: string | null;
  targetStartDate: string | null;
}

/** The signed-in manager's own team (B-185): never anyone else's. */
export interface MyTeamDto {
  manager: TeamPersonDto;
  reportsTo: TeamPersonDto | null;
  members: TeamPersonDto[];
  comingUp: TeamEventDto[];
  openRoles: TeamOpenRoleDto[];
}

export const coreTeamPaths = {
  mine: () => "/corehr/me/team",
} as const;

export const coreTeamQueryKeys = {
  all: () => ["core-team"] as const,
  mine: () => [...coreTeamQueryKeys.all(), "mine"] as const,
};

/** The Team page's Core HR part (`/api/corehr/me/team`). */
export function createCoreTeamApi(client: ApiClient) {
  return {
    mine: (signal?: AbortSignal) => client.get<MyTeamDto>(coreTeamPaths.mine(), { signal }),
  };
}
