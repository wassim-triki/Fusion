"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@repo/ds";
import { PageContainer, PageEmpty, PageError, PagePermissionNotice, PageSkeleton } from "@repo/ds/shell";
import { ApiError } from "@repo/api";
import { useBreadcrumbLabel } from "@/shell/breadcrumb-overrides";
import { useCompanyImport } from "../api/use-company-import";
import { useCanImport } from "./import-drop";
import { BringFrame } from "./bring-frame";
import { AgainStep } from "./again-step";
import { ChartStep } from "./chart-step";
import { Understood } from "./understood";

/**
 * One import, from What Fusion understood to Brought in (D-22, D-29). The step follows the import's own state:
 * the chart opens only once every question about the files is answered; bringing in and brought in are one frame.
 */
export default function ImportSession({ id }: { id: string }) {
  const t = useTranslations("companyImport");
  const router = useRouter();
  const step = useSearchParams().get("step");
  const allowed = useCanImport();
  const query = useCompanyImport(id);
  const data = query.data;
  const questionsOpen = data?.questions.some((question) => question.answer === null) ?? true;
  const view = !data ? null
    : data.status === "BringingIn" || data.status === "Stopped" || data.status === "BroughtIn" ? "bring"
    : step === "chart" && !questionsOpen ? (data.again ? "again" : "chart") : "understood";
  useBreadcrumbLabel(id, view === "bring" ? data?.companyName : view === "chart" ? t("chart.crumb") : view === "again" ? t("again.crumb") : view ? t("understood.title") : undefined);

  useEffect(() => {
    if (data?.status === "Discarded") router.replace("/import");
  }, [data?.status, router]);

  if (!allowed) return <PageContainer><PagePermissionNotice title={t("access.title")} description={t("access.description")} /></PageContainer>;
  if (query.error instanceof ApiError && query.error.status === 404)
    return (
      <PageContainer>
        <PageEmpty title={t("gone.title")} action={<Button asChild><Link href="/import">{t("gone.action")}</Link></Button>} />
      </PageContainer>
    );
  if (query.error) return <PageContainer><PageError title={t("error")} onRetry={() => void query.refetch()} /></PageContainer>;
  if (!data || data.status === "Discarded") return <PageSkeleton width="wide" label={t("loading")} />;

  if (view === "bring") return <BringFrame data={data} />;
  if (view === "chart") return <ChartStep data={data} />;
  if (view === "again") return <AgainStep data={data} />;
  return <Understood data={data} />;
}
