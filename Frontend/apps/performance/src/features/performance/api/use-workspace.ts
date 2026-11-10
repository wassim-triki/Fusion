"use client";

import { createContext, createElement, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { fusionAttentionQueryKeys, performanceQueryKeys, type CyclePhase, type YearStanding } from "@repo/api";
import { useApiMutation, useApiQuery, type ApiMutationInvalidation } from "@repo/api/query";
import { useApis } from "./use-performance";

const RECORD_CYCLE = /\/cycles\/([^/]+)\//;
type RecordCycleScopeState = { cycleId: string | null; setCycleId: (cycleId: string | null) => void };
const RecordCycleScopeContext = createContext<RecordCycleScopeState | null>(null);

/** Must wrap the workspace shell so its header and navigation share record-selected Cycle state. */
export function RecordCycleScopeProvider({ children }: { children: ReactNode }) {
  const [cycleId, setCycleId] = useState<string | null>(null);
  const value = { cycleId, setCycleId };
  return createElement(RecordCycleScopeContext.Provider, { value }, children);
}

/** Registers the Cycle that owns a loaded record with the workspace shell. */
export function RecordCycleScope({ cycleId, children }: { cycleId: string; children: ReactNode }) {
  const scope = useContext(RecordCycleScopeContext);
  const setCycleId = scope?.setCycleId;
  const clear = useCallback(() => setCycleId?.(null), [setCycleId]);
  useEffect(() => {
    setCycleId?.(cycleId);
    return clear;
  }, [clear, cycleId, setCycleId]);
  return children;
}

/**
 * The Cycle the workspace is looking at: a record address carries its own Cycle; any other page reads
 * `?cycle=`. Null means "the current Cycle", which the server resolves.
 */
export function useSelectedCycleId(): string | null {
  const recordCycleId = useContext(RecordCycleScopeContext)?.cycleId;
  const pathname = usePathname();
  const params = useSearchParams();
  const fromRecord = pathname.match(RECORD_CYCLE)?.[1];
  return recordCycleId ?? (fromRecord ? decodeURIComponent(fromRecord) : params.get("cycle"));
}

/** The year for the viewer (D-34, D-55): its phase, its steps with the people in each, HR's next move, the viewer's own place. */
export function useYear(cycleId: string | null) {
  const { performance } = useApis();
  return useApiQuery(
    performanceQueryKeys.year(cycleId ?? ""),
    (signal) => performance.year(cycleId as string, signal),
    { enabled: Boolean(cycleId) }
  );
}

/** What changes when the year moves on (D-58), and the nudges sent from the Year page (D-49). */
export function useYearCommands(cycleId: string | null) {
  const { performance } = useApis();
  // Moving the year on changes every page's phase, so everything of Performance refreshes, and Home's work with it.
  const invalidateQueries: ApiMutationInvalidation[] = [
    { queryKey: performanceQueryKeys.all() },
    { queryKey: fusionAttentionQueryKeys.all() },
  ];
  const move = useApiMutation(
    ({ expectedVersion, to }: { expectedVersion: number; to: CyclePhase }) => performance.moveYearOn(cycleId as string, expectedVersion, to),
    { invalidateQueries }
  );
  const nudge = useApiMutation(
    (who: { employeeIds?: string[]; standings?: YearStanding[] }) => performance.nudge(cycleId as string, who),
    { invalidateQueries: [{ queryKey: fusionAttentionQueryKeys.all() }] }
  );
  return { move, nudge };
}

/** The server-composed workspace for the selected Cycle: switchable Cycles, capabilities, destinations. */
export function useWorkspaceContext(enabled = true) {
  const { performance } = useApis();
  const cycleId = useSelectedCycleId();
  return useApiQuery(
    performanceQueryKeys.workspaceContext(cycleId),
    (signal) => performance.getWorkspaceContext(cycleId, signal),
    { enabled }
  );
}
