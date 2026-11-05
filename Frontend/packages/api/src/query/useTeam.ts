"use client";

import { useMemo } from "react";
import { coreTeamQueryKeys, createCoreTeamApi, type TeamEventKind } from "../core-team";
import { conversationQueryKeys, createConversationsApi } from "../performance-conversations";
import { createPerformanceApi, performanceQueryKeys, type YourPeopleQuery } from "../performance";
import { createPlatformApiClient } from "../platform";
import { useApiQuery } from "./useApiQuery";
import { usePhotos } from "./usePhoto";

const WHOLE_TEAM: YourPeopleQuery = { filter: "All", search: "", page: 1, pageSize: 100 };

/** The Team page's band, rail and Coming up from Core HR: the caller's own team (B-185), shared by Core HR and Performance. */
export function useMyTeam(enabled = true) {
  const api = useMemo(() => createCoreTeamApi(createPlatformApiClient()), []);
  return useApiQuery(coreTeamQueryKeys.mine(), (signal) => api.mine(signal), { enabled });
}

/**
 * Performance's part of the Team page: the manager's 1:1s with their reports and the current cycle's roster (each
 * person's plan and what needs attention). Only for viewers who can enter Performance; each part loads on its own.
 */
export function useTeamPerformance(enabled = true) {
  const { performance, conversations } = useMemo(() => {
    const client = createPlatformApiClient();
    return { performance: createPerformanceApi(client), conversations: createConversationsApi(client) };
  }, []);
  const context = useApiQuery(performanceQueryKeys.workspaceContext(null), (signal) => performance.getWorkspaceContext(null, signal), { enabled });
  const cycleId = context.data?.selected?.id ?? null;
  const canReview = context.data?.destinations.team ?? false;
  const roster = useApiQuery(
    performanceQueryKeys.yourPeople(cycleId ?? "none", WHOLE_TEAM),
    (signal) => performance.getYourPeople(cycleId as string, WHOLE_TEAM, signal),
    { enabled: enabled && canReview && Boolean(cycleId) },
  );
  const oneOnOnes = useApiQuery(conversationQueryKeys.oneOnOnes(), (signal) => conversations.listOneOnOnes(signal), { enabled });
  return { context, roster, oneOnOnes };
}

/** One person on the Team page's band, with everything their "what's next" is chosen from (the band words it). */
export interface TeamBandMember {
  employeeId: string;
  employeeKey: string;
  name: string;
  jobTitle: string | null;
  photo: string | null;
  joinsOn: string | null;
  events: { kind: TeamEventKind; date: string; years: number | null }[];
  /** The manager's next 1:1 with them, from Performance. */
  oneOnOneAt: string | null;
  /** The strongest objective signal on their plan this cycle, from Performance. */
  attention: "offTrack" | "atRisk" | null;
}

/**
 * The Team page's band, shared by Core HR's Overview and Org chart tabs and Performance's tab: the caller's team from
 * Core HR, joined with Performance's 1:1s and plan signals where the viewer can enter Performance.
 */
export function useTeamBand({ performance = true }: { performance?: boolean } = {}) {
  const team = useMyTeam();
  const perf = useTeamPerformance(performance && Boolean(team.data?.members.length));
  const photos = usePhotos(team.data ? [team.data.manager, team.data.reportsTo, ...team.data.members].map((person) => person?.photoUrl) : []);
  const members = useMemo<TeamBandMember[]>(() => {
    if (!team.data) return [];
    const meetings = new Map((perf.oneOnOnes.data?.reports ?? []).filter((row) => !row.ended).map((row) => [row.with.employeeId, row.nextMeetingAt]));
    const roster = new Map((perf.roster.data?.items ?? []).map((item) => [item.employeeId, item]));
    return team.data.members.map((person) => {
      const kind = roster.get(person.employeeId)?.facts?.execution?.attention?.kind;
      return {
        employeeId: person.employeeId,
        employeeKey: person.employeeKey,
        name: person.displayName,
        jobTitle: person.jobTitle,
        photo: (person.photoUrl && photos.get(person.photoUrl)) || null,
        joinsOn: person.joinsOn,
        events: team.data!.comingUp.filter((event) => event.employeeKey === person.employeeKey),
        oneOnOneAt: meetings.get(person.employeeId) ?? null,
        attention: kind === "offTrack" || kind === "atRisk" ? kind : null,
      };
    });
  }, [team.data, perf.oneOnOnes.data, perf.roster.data, photos]);
  return { team, perf, members, managerPhoto: (team.data?.manager.photoUrl && photos.get(team.data.manager.photoUrl)) || null, photos };
}
