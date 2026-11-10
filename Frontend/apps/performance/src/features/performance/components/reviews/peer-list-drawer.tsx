"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { ReviewPeerDto } from "@repo/api";
import { Button } from "@repo/ds/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@repo/ds/components/ui/sheet";
import { Skeleton } from "@repo/ds/components/ui/skeleton";
import { AsyncButton } from "@repo/ds/shell";
import { PersonInitials } from "@repo/performance-ui";
import { Check, Plus, RefreshCw, X } from "@repo/ds/icons";
import { useReview } from "../../api/use-reviews";
import { usePeerCommands, usePeerSuggestions } from "../../api/use-review-work";
import { ColleaguePicker, type PickedColleague } from "../conversations/colleague-picker";
import { dayLabel } from "./review-parts";
import { useTranslations } from "next-intl";
import { reportPerformanceFailure } from "@/features/performance/api/performance-failure";
import { useFormat } from "@repo/ds/lib/use-format";

type Person = { employeeId: string; displayName: string; detail?: string | null; added?: boolean };

/**
 * The reviewer's look at a person's peer list (board 10): who was nominated, suggestions from the person's year, swap,
 * remove or add, then approve. Approving sends each colleague the round's peer questions.
 */
export function PeerListDrawer({ reviewId, open, onOpenChange }: { reviewId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const format = useFormat();
  const t = useTranslations("reviews.PeerListDrawer");
  const review = useReview(reviewId, open);
  const suggestions = usePeerSuggestions(reviewId, open && Boolean(review.data?.canApprovePeers));
  const { approve } = usePeerCommands(reviewId);
  const [list, setList] = useState<Person[] | null>(null);
  const [swapping, setSwapping] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const peers = review.data?.peers ?? null;
  const canApprove = review.data?.canApprovePeers ?? false;

  useEffect(() => {
    if (peers && list === null) setList(peers.people.map((p: ReviewPeerDto) => ({ employeeId: p.employeeId, displayName: p.displayName })));
  }, [peers, list]);

  const subject = review.data?.subjectDisplayName ?? "";
  const first = subject.split(" ")[0] ?? subject;
  const people = useMemo(() => list ?? [], [list]);
  const exclude = useMemo(() => [...people.map((p) => p.employeeId), review.data?.subjectEmployeeId ?? "", review.data?.reviewerEmployeeId ?? ""],
    [people, review.data?.subjectEmployeeId, review.data?.reviewerEmployeeId]);
  const offered = (suggestions.data ?? []).filter((s) => !exclude.includes(s.employeeId));

  const use = (person: Person) => {
    setList((current) => {
      const base = current ?? [];
      if (swapping) return base.map((p) => (p.employeeId === swapping ? { ...person, added: true } : p));
      return base.length >= 5 ? base : [...base, { ...person, added: true }];
    });
    setSwapping(null);
    setAdding(false);
  };

  const submit = async () => {
    if (!review.data) return;
    try {
      await approve.mutateAsync({ ids: people.map((p) => p.employeeId), version: review.data.version });
      toast.success((people.length === 1 ? t("colleagueAskedForInput", { length: people.length }) : t("colleaguesAskedForInput", { length: people.length })));
      onOpenChange(false);
    } catch (error) {
      reportPerformanceFailure(error, t("theListCouldntBeApproved"));
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-[36rem]">
        {!review.data ? (
          <div className="space-y-3 p-7" role="status" aria-label={t("loadingThePeerList")}>
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-48 rounded-surface" />
          </div>
        ) : (
          <>
            <div className="flex items-start gap-4 px-7 pt-6 pb-5">
              <PersonInitials name={subject} size="lg" />
              <div className="min-w-0">
                <p className="type-meta text-muted-foreground">{t("peersForSReview", { subject })}</p>
                <SheetTitle className="mt-1 type-page-title text-foreground">
                  {peers?.nominatedAt ? (peers.people.length === 1 ? t("askedColleague", { first, length: peers.people.length }) : t("askedColleagues", { first, length: peers.people.length })) : t("chooseColleaguesFor", { first })}
                </SheetTitle>
                <SheetDescription className="mt-1 type-meta text-muted-foreground">
                  {[peers?.nominatedAt ? t("nominated", { dayLabel: dayLabel(peers.nominatedAt.slice(0, 10), format.locale) }) : null,
                    review.data.schedule?.peerInputDue ? t("theyAnswerBy", { peerInputDue: dayLabel(review.data.schedule.peerInputDue, format.locale) }) : null].filter(Boolean).join(" · ")}
                </SheetDescription>
              </div>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto px-7 pb-6">
              {peers?.approved ? (
                <p className="type-body-secondary text-muted-foreground">{t("thisListWasApproved", { dayLabel: dayLabel(peers.approvedAt?.slice(0, 10), format.locale) })}</p>
              ) : null}
              <ul className="divide-y divide-border rounded-surface bg-card">
                {people.map((person) => (
                  <li key={person.employeeId} className={swapping === person.employeeId ? "bg-primary-tint" : undefined}>
                    <div className="flex items-center gap-3 px-4 py-3.5">
                      <PersonInitials name={person.displayName} size="lg" />
                      <div className="min-w-0 flex-1">
                        <p className="type-label text-foreground">{person.displayName}</p>
                        {person.added ? <p className="type-meta text-muted-foreground">{t("addedByYou")}</p> : person.detail ? <p className="type-meta text-muted-foreground">{person.detail}</p> : null}
                      </div>
                      {canApprove ? (
                        <>
                          <Button size="sm" variant="outline" onClick={() => setSwapping(swapping === person.employeeId ? null : person.employeeId)}>
                            <RefreshCw className="size-3.5" aria-hidden />{swapping === person.employeeId ? t("keep") : t("swap")}
                          </Button>
                          <Button size="icon" variant="ghost" aria-label={t("remove", { displayName: person.displayName })}
                            onClick={() => setList((current) => (current ?? []).filter((p) => p.employeeId !== person.employeeId))}>
                            <X className="size-4" aria-hidden />
                          </Button>
                        </>
                      ) : null}
                    </div>
                    {swapping === person.employeeId ? (
                      <div className="px-4 pb-3.5">
                        <ColleaguePicker value={null} exclude={exclude} placeholder={t("whoInsteadOf", { value: (person.displayName.split(" ")[0]) ?? "" })}
                          onChange={(picked: PickedColleague) => use({ employeeId: picked.employeeId, displayName: picked.displayName, detail: picked.subtitle })} />
                      </div>
                    ) : null}
                  </li>
                ))}
                {canApprove && people.length < 5 ? (
                  <li className="px-4 py-3">
                    {adding ? (
                      <ColleaguePicker value={null} exclude={exclude} placeholder={t("addAColleague")}
                        onChange={(picked) => use({ employeeId: picked.employeeId, displayName: picked.displayName, detail: picked.subtitle })} />
                    ) : (
                      <button type="button" onClick={() => setAdding(true)} className="flex w-full items-center gap-3 rounded-control py-1 text-start type-body text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <span className="flex size-10 items-center justify-center rounded-full border border-dashed border-border"><Plus className="size-4" aria-hidden /></span>
                        {t("addAColleague")}
                        <span className="ms-auto type-meta">{t("upTo5")}</span>
                      </button>
                    )}
                  </li>
                ) : null}
              </ul>

              {canApprove && offered.length ? (
                <section aria-labelledby="suggested-heading">
                  <h3 id="suggested-heading" className="mb-2 type-meta text-muted-foreground">{t("suggestedFromSYear", { first })}</h3>
                  <ul className="space-y-2">
                    {offered.map((suggestion) => (
                      <li key={suggestion.employeeId} className="flex items-center gap-3">
                        <PersonInitials name={suggestion.displayName} size="md" />
                        <div className="min-w-0 flex-1">
                          <p className="type-label text-foreground">{suggestion.displayName}</p>
                          <p className="type-meta text-muted-foreground">
                            {[suggestion.sharedObjective ? t("sharedObjective") : null,
                              suggestion.feedbackExchanged ? t("feedbackExchanged", { feedbackExchanged: suggestion.feedbackExchanged }) : null,
                              suggestion.praiseExchanged ? t("praise", { praiseExchanged: suggestion.praiseExchanged }) : null].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <Button writes size="sm" variant="outline" disabled={!swapping && people.length >= 5}
                          onClick={() => use({ employeeId: suggestion.employeeId, displayName: suggestion.displayName, detail: suggestion.jobTitle })}>
                          <Plus className="size-3.5" aria-hidden />{swapping ? t("useInstead") : t("add")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>

            {canApprove ? (
              <div className="flex items-center gap-3 border-t border-border bg-popover px-7 py-4">
                <p className="flex-1 type-meta text-muted-foreground">{t("approvingSendsEachColleagueTheir")}</p>
                <Button variant="outline" onClick={() => onOpenChange(false)}>{t("later")}</Button>
                <AsyncButton pending={approve.isLoading} disabled={people.length === 0} onClick={() => void submit()}>
                  <Check className="size-4" aria-hidden />{t("approve", { length: people.length })} {people.length === 1 ? t("colleague") : t("colleagues")}
                </AsyncButton>
              </div>
            ) : null}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
