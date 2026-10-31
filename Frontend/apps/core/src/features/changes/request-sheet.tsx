"use client";

import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ArrowRight, Clock3, Quote, TriangleAlert, X } from "lucide-react";
import type { ChangeRequestDto, PeopleHomeAddressDto } from "@repo/api";
import { Button, PersonAvatar, Sheet, SheetContent, SheetTitle, Skeleton, Textarea, cn } from "@repo/ds";
import { StatusBadge } from "@repo/ds/shell";
import { useFormat } from "@repo/ds/lib/use-format";
import { useRefusal } from "@/i18n/words";
import { useChangeRequest, useRequestDecisions } from "@/features/people/changes/use-changes";
import { requestDay, useRequestWords } from "./request-words";

const STATUS_TONE = { Pending: "warning", Approved: "success", Declined: "danger", Withdrawn: "neutral" } as const;

export function RequestStatus({ request }: { request: ChangeRequestDto }) {
  const t = useTranslations("changes.requests.status");
  return <StatusBadge tone={STATUS_TONE[request.status]} dot>{t(request.status)}</StatusBadge>;
}

const addressLine = (address: PeopleHomeAddressDto | null | undefined) =>
  [address?.street, [address?.postalCode, address?.city].filter(Boolean).join(" "), address?.country].filter(Boolean).join(", ");

/** One part of the change: what it is, struck through, then what it becomes. */
function Row({ label, from, to }: { label: string; from?: string | null; to?: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-baseline gap-3 py-1.5">
      <span className="type-meta text-muted-foreground">{label}</span>
      <span className="min-w-0 text-[13.5px]">
        {from && to ? (
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            <s className="text-muted-foreground">{from}</s>
            <ArrowRight aria-hidden className="size-3.5 text-muted-foreground rtl:rotate-180" />
            <b className="font-semibold">{to}</b>
          </span>
        ) : (
          <b className="font-semibold">{to ?? from}</b>
        )}
      </span>
    </div>
  );
}

/** A request as its approver reads it: what changes, why, who asked, and the one-click answer. */
export function RequestDetail({ request, onClose }: { request: ChangeRequestDto; onClose: () => void }) {
  const t = useTranslations("changes");
  const tr = useTranslations("changes.requests");
  const format = useFormat();
  const refusal = useRefusal();
  const words = useRequestWords()(request);
  const { approve, decline, withdraw } = useRequestDecisions();
  const [declining, setDeclining] = useState(false);
  const [why, setWhy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const c = request.change;
  const busy = approve.isLoading || decline.isLoading || withdraw.isLoading;
  const first = request.person.displayName.split(" ")[0] ?? request.person.displayName;

  const act = async (run: () => Promise<unknown>, done: string) => {
    setError(null);
    try {
      await run();
      toast.success(done);
      onClose();
    } catch (caught) {
      setError(refusal(caught, tr("actionFailed")));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-start gap-3.5 border-b px-[22px] pb-4 pt-5">
        <PersonAvatar name={request.person.displayName} className="size-11" />
        <div className="min-w-0 flex-1">
          <RequestStatus request={request} />
          <h2 className="mt-1.5 text-lg font-semibold leading-snug">{words.title}</h2>
          <p className="truncate type-meta text-muted-foreground">
            {[request.person.jobTitle, request.person.unit].filter(Boolean).join(", ")}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("close")} onClick={onClose}><X className="size-4" /></Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-[22px] pb-4 pt-3">
        {request.stale ? (
          <p role="alert" className="mb-3 flex gap-2.5 rounded-inset bg-warning-subtle px-3.5 py-3 type-body text-warning">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />{request.stale}
          </p>
        ) : null}

        <section className="grid border-b pb-3">
          {request.kind === "HomeAddress" && request.address ? (
            <Row label={tr("address")} from={addressLine(request.address.from) || t("facts.none")} to={addressLine(request.address.to)} />
          ) : null}
          {c?.titleChanged ? <Row label={t("facts.title")} from={c.titleFrom} to={c.titleTo} /> : null}
          {c?.unitChanged ? <Row label={t("facts.unit")} from={c.unitFrom} to={c.unitTo} /> : null}
          {c?.locationChanged ? <Row label={t("facts.location")} from={c.locationFrom ?? t("facts.none")} to={c.locationTo ?? t("facts.none")} /> : null}
          {c?.managerChanged ? (
            <Row label={t("reportsTo")} from={c.managerFrom?.displayName ?? t("noManager")} to={c.managerTo?.displayName ?? t("noManager")} />
          ) : null}
          {c?.teamOutcome && c.teamCount > 0 ? (
            <Row label={t("team.title", { name: first })}
              to={c.teamOutcome === "Stays" && c.teamManager
                ? t("coming.teamStays", { count: c.teamCount, manager: c.teamManager.displayName })
                : t("coming.teamAlong", { count: c.teamCount })} />
          ) : null}
          {request.reason ? <Row label={tr("reason")} to={request.reason} /> : null}
          {request.kind !== "HomeAddress" ? (
            <Row label={request.kind === "EndEmployment" ? tr("lastDay") : tr("from")} to={format.date(requestDay(request))} />
          ) : null}
        </section>

        {request.description ? (
          <section className="grid gap-1.5 border-b py-3.5">
            <h3 className="type-meta text-muted-foreground">{tr("said")}</h3>
            <p className="flex gap-2 type-body"><Quote aria-hidden className="mt-1 size-3.5 shrink-0 text-muted-foreground" />{request.description}</p>
          </section>
        ) : null}
        {request.note ? (
          <section className="grid gap-1.5 border-b py-3.5">
            <h3 className="type-meta text-muted-foreground">{tr("note")}</h3>
            <p className="whitespace-pre-line type-body">{request.note}</p>
          </section>
        ) : null}

        <div className="flex items-center gap-2.5 py-3.5">
          <PersonAvatar name={request.requestedBy.displayName} className="size-7 text-[11px]" />
          <p className="type-meta text-muted-foreground">{tr("askedBy", { name: request.requestedBy.displayName, date: format.date(request.requestedAt) })}</p>
        </div>
        {words.decided ? (
          <div className="grid gap-1.5 rounded-inset bg-inlay px-3.5 py-3">
            <p className="flex items-center gap-2 type-meta text-muted-foreground"><Clock3 aria-hidden className="size-3.5" />{words.decided}</p>
            {request.declineReason ? <p className="type-body">“{request.declineReason}”</p> : null}
          </div>
        ) : null}

        {declining ? (
          <section className="grid gap-2 pt-2 animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
            <label htmlFor="decline-why" className="type-label font-semibold">{tr("declineTitle")}</label>
            <Textarea id="decline-why" autoFocus rows={3} maxLength={500} value={why} onChange={(event) => setWhy(event.target.value)}
              placeholder={tr("declinePlaceholder")} className="resize-none" />
          </section>
        ) : null}
        {error ? <p role="alert" className="pt-2 type-body text-destructive">{error}</p> : null}
      </div>

      {request.canDecide || request.canWithdraw ? (
        <footer className="flex items-center justify-end gap-2.5 border-t bg-popover px-[22px] py-3.5">
          {request.canWithdraw ? (
            <Button type="button" variant="outline" disabled={busy}
              onClick={() => void act(() => withdraw.mutateAsync(request.id), tr("withdrawn"))}>{tr("withdraw")}</Button>
          ) : declining ? (
            <>
              <Button type="button" variant="ghost" onClick={() => { setDeclining(false); setWhy(""); }}>{tr("back")}</Button>
              <Button type="button" variant="destructive" disabled={!why.trim() || busy}
                onClick={() => void act(() => decline.mutateAsync({ id: request.id, reason: why.trim() }), tr("declined", { name: request.requestedBy.displayName.split(" ")[0] ?? "" }))}>
                {tr("confirmDecline")}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setDeclining(true)}>{tr("decline")}</Button>
              <Button type="button" disabled={busy || Boolean(request.stale)}
                onClick={() => void act(() => approve.mutateAsync(request.id),
                  request.kind === "HomeAddress" ? tr("approvedAddress") : tr("approved", { date: words.date }))}>
                {tr("approve")}
              </Button>
            </>
          )}
        </footer>
      ) : null}
    </div>
  );
}

/** The request sheet, opened by id: from a list row, a notification or Home (`?request=`). */
export function RequestSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const tr = useTranslations("changes.requests");
  const request = useChangeRequest(id);
  return (
    <Sheet open={Boolean(id)} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent side="right" showCloseButton={false} className="gap-0 p-0 data-[side=right]:w-[480px] data-[side=right]:sm:max-w-[480px]">
        <SheetTitle className="sr-only">{tr("title")}</SheetTitle>
        {request.data ? (
          <RequestDetail key={`${request.data.id}-${request.data.status}`} request={request.data} onClose={onClose} />
        ) : request.error ? (
          <div className="grid gap-3 p-[22px]">
            <p className="type-body">{tr("notFound")}</p>
            <Button type="button" variant="outline" className="justify-self-start" onClick={onClose}>{tr("back")}</Button>
          </div>
        ) : (
          <div className={cn("grid gap-3 p-[22px]")}><Skeleton className="h-12" /><Skeleton className="h-28" /><Skeleton className="h-10" /></div>
        )}
      </SheetContent>
    </Sheet>
  );
}
