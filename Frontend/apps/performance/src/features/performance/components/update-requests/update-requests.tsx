"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { UpdateRequestDto } from "@repo/api";
import { Avatar, AvatarFallback } from "@repo/ds/components/ui/avatar";
import { Button } from "@repo/ds/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@repo/ds/components/ui/dialog";
import { Textarea } from "@repo/ds/components/ui/textarea";
import { AsyncButton } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";
import { LineChart, MessageSquare } from "@/lib/icons";
import { reportPerformanceFailure } from "@/features/performance/api/performance-failure";
import { useUpdateRequestMutations, useUpdateRequests } from "../../api/use-update-requests";
import { initials } from "../plan/plan-lib";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";

const NOTE_MAX = 500;

/** The open requests that concern one objective: those on it, and those on the whole plan. */
export function openRequestsFor(requests: UpdateRequestDto[] | undefined, objectiveId: string | null) {
  return (requests ?? []).filter((item) => item.state === "Open" && (objectiveId === null ? item.objectiveId === null : item.objectiveId === objectiveId));
}

/**
 * The responsible reviewer asks for a progress update on a target that is already fixed: one objective, or
 * the whole plan. Asking again for the same target returns the request already open, so it's safe to repeat.
 */
export function RequestUpdateDialog({ cycleId, planId, personName, objective, onClose }: {
  cycleId: string;
  planId: string;
  personName: string;
  /** The objective asked about; without one, the request is for the whole plan. */
  objective?: { id: string; title: string };
  onClose: () => void;
}) {
  const t = useTranslations("conversations.RequestUpdateDialog");
  const { request } = useUpdateRequestMutations(cycleId, planId);
  const [note, setNote] = useState("");

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !request.isLoading) onClose(); }}>
      <DialogContent className="w-[min(32rem,calc(100vw-2rem))] max-w-none">
        <DialogHeader className="min-w-0">
          <DialogTitle className="break-words">{t("askForAnUpdate", { personName })}</DialogTitle>
          <DialogDescription className="break-words">{objective ? objective.title : t("onTheWholePlan")}</DialogDescription>
        </DialogHeader>
        <div className="min-w-0">
          <label htmlFor="update-request-note" className="type-label text-foreground">
            {t("note")} <span className="text-muted-foreground">{t("optional")}</span>
          </label>
          <div className="relative mt-2">
            <Textarea
              id="update-request-note"
              className="min-h-20 resize-none pb-6"
              maxLength={NOTE_MAX}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <span className="pointer-events-none absolute bottom-2 inset-e-3 type-meta tabular-nums text-muted-foreground/70">
              {note.length}/{NOTE_MAX}
            </span>
          </div>
        </div>
        {request.error ? <p className="type-body text-destructive" role="alert">{request.error.message}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={request.isLoading}>{t("cancel")}</Button>
          <AsyncButton
            pending={request.isLoading}
            onClick={async () => {
              try {
                await request.mutateAsync({ objectiveId: objective?.id ?? null, note: note.trim() || null });
                toast.success(t("updateRequestedFrom", { personName }));
                onClose();
              } catch { /* shown above */ }
            }}
          >
            {t("sendRequest")}
          </AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The requester's side, where the target already is: Request update, or — once asked — when, with Withdraw.
 * Shown on an objective card or record for one objective, and in the plan header for the whole plan.
 */
export function RequestUpdateAction({ cycleId, planId, personName, objective, size = "sm" }: {
  cycleId: string;
  planId: string;
  personName: string;
  objective?: { id: string; title: string };
  size?: "sm" | "default";
}) {
  const format = useFormat();
  const t = useTranslations("conversations.RequestUpdateAction");
  const requests = useUpdateRequests(cycleId, planId);
  const { withdraw } = useUpdateRequestMutations(cycleId, planId);
  const [asking, setAsking] = useState(false);
  const open = openRequestsFor(requests.data, objective?.id ?? null)[0];

  if (open) {
    return (
      <span className="inline-flex items-center gap-2 type-meta text-muted-foreground">
        <span>
          {t("updateRequested")} <time dateTime={open.requestedAt}>{format.date(open.requestedAt.slice(0, 10))}</time>
        </span>
        <AsyncButton
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          pending={withdraw.isLoading}
          onClick={async () => {
            try {
              await withdraw.mutateAsync({ requestId: open.id, expectedVersion: open.version });
            } catch (error) {
              reportPerformanceFailure(error, t("couldNotWithdrawTheRequest"));
            }
          }}
        >
          {t("withdraw")}
        </AsyncButton>
      </span>
    );
  }

  return (
    <>
      <Button variant="outline" size={size} onClick={() => setAsking(true)} disabled={requests.isLoading}>
        <MessageSquare className="size-3.5" data-icon="inline-start" /> {t("requestUpdate")}
      </Button>
      {asking ? <RequestUpdateDialog cycleId={cycleId} planId={planId} personName={personName} objective={objective} onClose={() => setAsking(false)} /> : null}
    </>
  );
}

/**
 * The owner's band for one request: who asked and when, their note, and that recording progress answers it.
 * In the record's details it also offers Record progress; in record mode the recorder is right below.
 */
export function RequestBand({ request, onRecord }: { request: UpdateRequestDto; onRecord?: () => void }) {
  const format = useFormat();
  const t = useTranslations("conversations.RequestBand");
  return (
    <div className="flex items-start gap-3 rounded-surface border border-primary-ring bg-primary-tint px-4 py-3.5">
      <Avatar className="size-8 shrink-0">
        <AvatarFallback hue={request.requestedByName} className="type-meta">{initials(request.requestedByName)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="type-body text-foreground">
          <span className="font-semibold">{t("askedForAnUpdate", { requestedByName: request.requestedByName })}</span>
          <span className="text-muted-foreground"> · <time dateTime={request.requestedAt}>{format.date(request.requestedAt.slice(0, 10))}</time></span>
        </p>
        {request.note ? <p className="mt-1 whitespace-pre-wrap break-words type-body text-foreground/85">{request.note}</p> : null}
        <p className="mt-1 type-meta text-muted-foreground">{t("recordingProgressAnswersIt")}</p>
      </div>
      {onRecord ? (
        <Button size="sm" className="shrink-0" onClick={onRecord}>
          <LineChart className="size-3.5" data-icon="inline-start" /> {t("recordProgress")}
        </Button>
      ) : null}
    </div>
  );
}

/** On an objective card: the request that concerns it, as a quiet marker beside Update progress. */
export function ObjectiveRequestMarker({ request }: { request: UpdateRequestDto }) {
  const format = useFormat();
  const t = useTranslations("conversations.ObjectiveRequestMarker");
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-tint px-2 py-0.5 type-meta-strong text-primary-ink ring-1 ring-inset ring-primary-ring">
      <span className="size-1.5 rounded-full bg-primary" aria-hidden />
      {t("asked", { value: (request.requestedByName.split(/\s+/)[0]) ?? "", formatDate: format.date(request.requestedAt.slice(0, 10)) })}
    </span>
  );
}

/**
 * The owner's view of an open update request on one objective, in the objective's record: the band, with
 * Record progress while reading the details. A plan-level request also shows here, since progress on any
 * objective answers it.
 */
export function RecordRequestBand({ cycleId, planId, objectiveId, onRecord }: {
  cycleId: string;
  planId: string;
  objectiveId: string;
  onRecord?: () => void;
}) {
  const requests = useUpdateRequests(cycleId, planId);
  const open = [...openRequestsFor(requests.data, objectiveId), ...openRequestsFor(requests.data, null)];
  if (open.length === 0) return null;
  return (
    <div className={cn("space-y-2")}>
      {open.map((item) => <RequestBand key={item.id} request={item} onRecord={onRecord} />)}
    </div>
  );
}
