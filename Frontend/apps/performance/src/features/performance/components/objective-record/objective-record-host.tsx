"use client";

import { useMemo, useState } from "react";
import { performanceFailure } from "../../api/performance-failure";
import { classifyApiError } from "@repo/api";
import { SheetTitle } from "@repo/ds/components/ui/sheet";
import { useCurrentCycle, useCycle, useGoal } from "../../api/use-performance";
import { useWorkspaceContext } from "../../api/use-workspace";
import { CompanyComposerHost } from "../goals/company-composer-host";
import { OrgComposerHost } from "../goals/org-composer-host";
import type { ObjectiveRef } from "./objective-ref";
import { toObjectiveRecord, type ObjectiveRecord, type RecordSectionId } from "./objective-record-model";
import { ObjectiveRecordSheet, type RecordSheetState } from "./objective-record-sheet";
import { RecordActions } from "./record-actions";
import { GoalHead, GoalHero, GoalStory, GoalUnits } from "./goal-panel";
import { ProgressDialog } from "./progress-dialog";
import { ContributionSection } from "./sections/contribution-section";
import { DescriptionSection } from "./sections/description-section";
import { FeedbackSection } from "./sections/feedback-section";
import { StatusSection } from "./sections/status-section";
import { useObjectiveRecord } from "./use-objective-record";
import { RecordRequestBand, RequestUpdateAction } from "../update-requests/update-requests";
import { useSay } from "@repo/ds/lib/say";

/**
 * The one objective record. Its canonical cycle-and-objective address renders
 * it as a page; opening it from a workspace intercepts the same address and renders it as a sheet over
 * that workspace. Either way the host fetches the detail for exactly the addressed Cycle, never "the
 * current" one, and owns the record's task mode and the composers its Edit action opens.
 */
export function ObjectiveRecordHost({ reference, presentation = "sheet" }: { reference: ObjectiveRef; presentation?: "sheet" | "page" }) {
  const { mode, open, close } = useObjectiveRecord();
  const openRef: ObjectiveRef | null = reference;

  // Keep the last reference while the sheet animates closed, so content doesn't flash to loading.
  const [shownRef, setShownRef] = useState<ObjectiveRef | null>(openRef);
  if (openRef && (openRef.cycleId !== shownRef?.cycleId || openRef.objectiveId !== shownRef?.objectiveId)) {
    setShownRef(openRef);
  }

  const detail = useGoal(shownRef?.cycleId ?? null, shownRef?.objectiveId ?? null);
  const cycle = useCycle(shownRef?.cycleId ?? null);
  const current = useCurrentCycle();
  const context = useWorkspaceContext();
  const [editing, setEditing] = useState<{ kind: ObjectiveRecord["kind"]; objectiveId: string } | null>(null);

  // Only trust data that belongs to the reference being shown — a query keeping its previous result while
  // the next one loads must not paint the old objective into the new record.
  const matches = detail.data?.node.id === shownRef?.objectiveId && detail.data?.cycleId === shownRef?.cycleId;
  const model = useSay("objective.model");
  const record = useMemo(() => (matches && detail.data ? toObjectiveRecord(detail.data, model) : null), [matches, detail.data, model]);

  const state: RecordSheetState = performanceFailure(detail.error).unavailable
    ? { status: "denied" }
    : record
    ? { status: "ready", record }
    : detail.error
      ? ["auth", "validation"].includes(classifyApiError(detail.error))
        ? { status: "denied" }
        : { status: "error", onRetry: () => void detail.refetch() }
      : { status: "loading" };

  // Organization direction is a workspace for the current Cycle; a record from another Cycle reads in place.
  const canOpenDirection =
    (context.data?.capabilities.canViewOrgDirection ?? false) && shownRef?.cycleId === current.data?.cycle.id;
  // Updating progress is a small dialog over the panel (D-63); an address asking to record opens it too.
  const [updating, setUpdating] = useState(false);
  const canUpdate = Boolean(record?.can.updateProgress && record.isExecuting);
  const dialogOpen = canUpdate && (updating || mode === "record");
  const update = canUpdate ? () => setUpdating(true) : undefined;

  return (
    <>
      <ObjectiveRecordSheet
        presentation={presentation}
        open={openRef !== null}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        state={state}
        header={(r) => (
          <>
            <GoalHead record={r} titleAs={presentation === "sheet" ? SheetTitle : "h1"} onOpen={(ref) => open(ref, { replace: presentation === "sheet" })} />
            {r.kind === "plan" && r.source.plan && r.isExecuting ? (
              r.can.updateProgress ? (
                <div className="mt-4">
                  <RecordRequestBand cycleId={r.ref.cycleId} planId={r.source.plan.planId} objectiveId={r.ref.objectiveId} onRecord={update} />
                </div>
              ) : r.source.plan.canRequestUpdate ? (
                <div className="mt-4">
                  <RequestUpdateAction cycleId={r.ref.cycleId} planId={r.source.plan.planId}
                    personName={r.source.plan.owner.name ?? "this person"} objective={{ id: r.ref.objectiveId, title: r.title }} />
                </div>
              ) : null
            ) : null}
          </>
        )}
        renderSection={(id, r) => renderSection(id, r, (ref) => open(ref, { replace: presentation === "sheet" }), update)}
        actions={(r) => (
          <RecordActions
            record={r}
            canOpenDirection={canOpenDirection}
            onEdit={() => setEditing({ kind: r.kind, objectiveId: r.ref.objectiveId })}
            onRemoved={close}
            presentation={presentation}
          />
        )}
      />
      {record && canUpdate ? (
        <ProgressDialog
          record={record}
          open={dialogOpen}
          onOpenChange={(next) => {
            setUpdating(next);
            if (!next && mode === "record") open(record.ref, { replace: true });
          }}
        />
      ) : null}

      {editing && cycle.data ? (
        editing.kind === "company" ? (
          <CompanyComposerHost
            cycle={cycle.data.cycle}
            state={{ mode: "edit", objectiveId: editing.objectiveId }}
            onClose={() => setEditing(null)}
          />
        ) : (
          <OrgComposerHost
            cycle={cycle.data.cycle}
            state={{ mode: "edit", objectiveId: editing.objectiveId }}
            ownUnit={null}
            onClose={() => setEditing(null)}
          />
        )
      ) : null}
    </>
  );
}

function renderSection(
  id: RecordSectionId,
  record: ObjectiveRecord,
  open: (ref: ObjectiveRef) => void,
  update: (() => void) | undefined
) {
  switch (id) {
    case "hero":
      return <GoalHero record={record} onUpdate={update} />;
    case "status":
      return <StatusSection record={record} />;
    case "story":
      return <GoalStory record={record} />;
    case "units":
      return <GoalUnits record={record} onOpen={open} />;
    case "description":
      return <DescriptionSection record={record} />;
    case "contribution":
      return <ContributionSection record={record} />;
    case "feedback":
      return <FeedbackSection record={record} />;
  }
}
