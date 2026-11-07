import type { PersonLeaveDto } from "./core-people";
import type { ApiClient } from "./types";

/** `LeaveStarts` is dated the first day off, `LeaveEnds` the day they are back. */
export type TeamEventKind =
  | "Joins"
  | "MovesIn"
  | "Leaves"
  | "MovesOut"
  | "NewJob"
  | "Anniversary"
  | "Birthday"
  | "LeaveStarts"
  | "LeaveEnds";

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
  /** Leave they are on, or their next, with its type. */
  leave?: PersonLeaveDto | null;
}

/** Something in the team's next 30 days: `years` for an anniversary, `jobTitle` for a new job. */
export interface TeamEventDto {
  kind: TeamEventKind;
  date: string;
  employeeKey: string;
  years: number | null;
  jobTitle: string | null;
  leaveType?: string | null;
}

export interface TeamOpenRoleDto {
  id: string;
  jobTitle: string;
  placeName: string | null;
  targetStartDate: string | null;
  /** Set when the role was filled lately: the first name of who took it. */
  filledBy: string | null;
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
