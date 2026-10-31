"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@repo/ds/components/ui/button";
import { Input } from "@repo/ds/components/ui/input";
import { DatePicker } from "@repo/ds/components/ui/date-picker";
import { Label } from "@repo/ds/components/ui/label";
import { PageContainer, PageHeader, PagePermissionNotice, PageSkeleton } from "@repo/ds/shell";
import { useReviewRoundMutations } from "@/features/performance/api/use-reviews";
import { useWorkspaceContext } from "@/features/performance/api/use-workspace";
import { ContentUnavailable } from "@/features/performance/components/content-unavailable";
import { roundHref, withCycle } from "@/lib/performance-routes";
import { useTranslations } from "next-intl";
import { reportPerformanceFailure } from "@/features/performance/api/performance-failure";

export default function NewReviewRoundPage() {
  const t = useTranslations("reviews.NewReviewRoundPage");
  const router = useRouter();
  const context = useWorkspaceContext();
  const isAdmin = context.data?.capabilities.administers ?? false;
  const cycle = context.data?.selected ?? null;
  const cycleId = cycle?.id ?? "";
  const { create } = useReviewRoundMutations(cycleId);
  const [name, setName] = useState("Mid-year review");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [pending, setPending] = useState(false);
  const formStart = periodStart || cycle?.startDate || "";
  const formEnd = periodEnd || cycle?.endDate || "";

  if (context.isLoading) return <PageSkeleton rows={5} width="wide" label={t("loadingCycle")} />;
  if (!isAdmin) return <PagePermissionNotice title={t("administrationOnly")} description={t("onlyPerformanceAdministratorsCanCreate")} />;
  if (context.error) return <ContentUnavailable error={context.error} onRetry={context.refetch} subject={t("cycle")} />;
  if (!cycle) return <PagePermissionNotice title={t("noActiveCycle")} description={t("aReviewRoundBelongsTo")} />;
  if (cycle.state !== "Active") return <PagePermissionNotice title={t("cycleIsNotActive")} description={t("reviewRoundsCanOnlyBe")} />;
  const activeCycle = cycle;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const created = await create.mutateAsync({ name: name.trim(), periodStart: formStart, periodEnd: formEnd });
      router.push(withCycle(roundHref(created.id), activeCycle.id));
    } catch (error) {
      reportPerformanceFailure(error, t("couldNotCreateThisReview"));
      setPending(false);
    }
  }

  return (
    <PageContainer width="wide">
      <PageHeader className="mb-4" title={t("startAReviewRound")} eyebrow={cycle.name} back={{ href: withCycle("/reviews", cycle.id), label: t("reviews") }} />
      <form onSubmit={submit} className="max-w-3xl">
        <p className="max-w-2xl type-body text-muted-foreground">{t("aRoundOpensAReview")}</p>
        <div className="mt-7 grid gap-5 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="round-name">{t("roundName")}</Label>
            <Input id="round-name" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="period-start">{t("reviewPeriodStarts")}</Label>
            <DatePicker id="period-start" min={cycle.startDate} max={cycle.endDate} value={formStart} onChange={setPeriodStart} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="period-end">{t("reviewPeriodEnds")}</Label>
            <DatePicker id="period-end" min={formStart || cycle.startDate} max={cycle.endDate} value={formEnd} onChange={setPeriodEnd} />
          </div>
        </div>
        <div className="mt-7 flex flex-wrap justify-end gap-2 border-t border-border pt-5">
          <Button type="button" variant="ghost" onClick={() => router.push(withCycle("/reviews", cycle.id))}>{t("cancel")}</Button>
          <Button type="submit" disabled={pending || !name.trim() || !formStart || !formEnd || formEnd < formStart}>{pending ? t("creating") : t("createRound")}</Button>
        </div>
      </form>
    </PageContainer>
  );
}
