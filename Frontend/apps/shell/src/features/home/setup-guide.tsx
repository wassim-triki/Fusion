"use client";

import Image from "next/image";

import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, FileSpreadsheet, Upload } from "lucide-react";
import { ApiError, createCoreImportApi, createPlatformApiClient, coreImportQueryKeys } from "@repo/api";
import { useApiQuery, useMyCard, usePhoto, useSetupGuide, useTenantSummary, type SetupGuide, type SetupStepKey } from "@repo/api/query";
import { canImportCoreEmployees, canManageCoreOrganization, canViewTenantAdministration, useAuth } from "@repo/auth";
import { Button, PersonAvatar, Skeleton, cn } from "@repo/ds";
import { ProgressSegments } from "@repo/ds/shell";

const MAX_FILES = 12;
const MAX_BYTES = 10 * 1024 * 1024;

/** Where each step is done, through the shell. */
const STEP_HREF: Record<SetupStepKey, string> = {
  company: "/core/settings/brand",
  organization: "/core/organization",
  invite: "/core/people?invite=1",
  roles: "/core/settings/roles",
  performance: "/performance/cycle/setup",
};

const hiddenKey = (tenantId: string, userId: string) => `fusion.guide.hidden.${tenantId}.${userId}`;

/**
 * Whether Home opens on day one (D-09): for an administrator, until every step is done or they hide the guide. The
 * hide is the viewer's own, kept in this browser.
 */
export function useHomeSetup(): { show: boolean; guide: SetupGuide; hide: () => void } {
  const { user } = useAuth();
  const admin = Boolean(user?.tenantId) && canViewTenantAdministration(user);
  const key = user?.tenantId && user.userId ? hiddenKey(user.tenantId, user.userId) : null;
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!key) return;
    try {
      setHidden(window.localStorage.getItem(key) === "1");
    } catch {
      setHidden(false);
    }
  }, [key]);
  const guide = useSetupGuide({
    enabled: admin && !hidden,
    selfEmployeeId: user?.employeeId,
    performance: Boolean(user?.moduleEntitlements?.includes("Performance")),
  });
  const hide = () => {
    setHidden(true);
    try {
      if (key) window.localStorage.setItem(key, "1");
    } catch {
      // Storage off: hidden for this visit.
    }
  };
  return { show: admin && !hidden && (guide.pending || guide.open !== null), guide, hide };
}

/** "Set up <company>": the five steps as a vertical list, the open one holding what it needs. No stepper. */
export function SetupGuideCard({ guide, onHide }: { guide: SetupGuide; onHide: () => void }) {
  const t = useTranslations("home.setup");
  const company = useTenantSummary().data?.name ?? "";
  if (guide.pending) {
    return (
      <section aria-busy="true" aria-label={t("loading")} className="space-y-4 rounded-surface bg-card p-7">
        <Skeleton className="h-6 w-56" />
        {[0, 1, 2, 3, 4].map((row) => (
          <Skeleton key={row} className="h-12 w-full rounded-control" />
        ))}
      </section>
    );
  }
  return (
    <section aria-labelledby="setup-title" className="grid gap-5 rounded-surface bg-card px-7 pt-6 pb-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="setup-title" className="type-section-title text-foreground">{t("title", { company })}</h2>
        <ProgressSegments done={guide.doneCount} total={guide.steps.length} label={t("progress", { done: guide.doneCount, total: guide.steps.length })} />
      </div>
      <ol className="grid">
        {guide.steps.map((step, index) => (
          <Step key={step.key} index={index} stepKey={step.key} done={step.done} open={guide.open === step.key} />
        ))}
      </ol>
      <div className="flex justify-end border-t border-border pt-3">
        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={onHide}>
          {t("hide")}
        </Button>
      </div>
    </section>
  );
}

function Step({ index, stepKey, done, open }: { index: number; stepKey: SetupStepKey; done: boolean; open: boolean }) {
  const t = useTranslations("home.setup");
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-4 border-t border-border py-4 first:border-t-0 first:pt-1">
      <span
        className={cn(
          "grid size-7 place-items-center rounded-full border-[1.5px] text-xs font-semibold",
          done && "border-primary bg-primary text-primary-foreground",
          open && "border-2 border-primary text-primary-ink",
          !done && !open && "border-border text-muted-foreground",
        )}
      >
        {done ? <Check className="size-4" strokeWidth={2.4} aria-label={t("done")} /> : index + 1}
      </span>
      <div className="min-w-0">
        <p className={cn("type-panel-title leading-7", !done && !open && "text-muted-foreground")}>{t(`steps.${stepKey}.title`)}</p>
        <p className="type-meta text-muted-foreground">{t(`steps.${stepKey}.meta`)}</p>
        {open && stepKey === "organization" ? <OrganizationStep /> : null}
      </div>
      {done ? (
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
          <a href={STEP_HREF[stepKey]}>{t(stepKey === "company" ? "edit" : "open")}</a>
        </Button>
      ) : open && stepKey !== "organization" ? (
        <Button asChild size="sm">
          <a href={STEP_HREF[stepKey]}>{t(`steps.${stepKey}.action`)}</a>
        </Button>
      ) : (
        <span />
      )}
    </li>
  );
}

/**
 * The open step on day one: the import's drop (B-186) and the chart it will build, starting from the viewer. Dropped
 * files start the import and open it in Core HR; an import already under way is picked up where it was.
 */
function OrganizationStep() {
  const t = useTranslations("home.setup.drop");
  const { user } = useAuth();
  const allowed = canManageCoreOrganization(user) && canImportCoreEmployees(user);
  const api = useMemo(() => createCoreImportApi(createPlatformApiClient()), []);
  const active = useApiQuery(coreImportQueryKeys.active(), (signal) => api.active(signal), { enabled: allowed });
  const company = useTenantSummary().data?.name;
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState<number | null>(null);
  const [over, setOver] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const activeId = active.data?.id ?? null;

  async function start(files: File[]) {
    if (files.length === 0) return;
    if (files.length > MAX_FILES) return setProblem(t("tooMany", { max: MAX_FILES }));
    const big = files.find((file) => file.size > MAX_BYTES);
    if (big) return setProblem(t("tooBig", { name: big.name }));
    setProblem(null);
    setReading(files.length);
    try {
      const started = await api.start(files, company);
      window.location.assign(`/core/import/${started.id}`);
    } catch (caught) {
      setReading(null);
      setProblem(caught instanceof ApiError && caught.message ? caught.message : t("failed"));
    }
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    if (allowed && !activeId && reading === null) void start([...event.dataTransfer.files]);
  };

  return (
    <div className="mt-3.5">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          "grid gap-4 rounded-surface border-[1.5px] border-dashed border-input px-[18px] pt-4 pb-6 transition-colors",
          over && "border-primary bg-primary-tint",
        )}
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-h-9 min-w-0 flex-1 items-center gap-2.5">
            {reading !== null ? (
              <>
                <FileSpreadsheet className="size-5 text-muted-foreground" aria-hidden />
                <span className="type-label">{t("reading", { count: reading })}</span>
                <span className="h-1 w-28 overflow-hidden rounded-full bg-inlay">
                  <i className="block h-full w-2/5 animate-pulse rounded-full bg-primary" />
                </span>
              </>
            ) : (
              <>
                <Upload className="size-5 text-muted-foreground" aria-hidden />
                <div>
                  <p className="type-label">{activeId ? t("underWay") : t("title")}</p>
                  <p className="type-meta text-muted-foreground">{activeId ? t("underWayMeta") : t("meta")}</p>
                </div>
              </>
            )}
          </div>
          {activeId ? (
            <Button asChild>
              <a href={`/core/import/${activeId}`}>{t("continue")}</a>
            </Button>
          ) : (
            <Button type="button" disabled={!allowed || reading !== null} onClick={() => input.current?.click()}>
              {t("choose")}
            </Button>
          )}
          <input
            ref={input}
            type="file"
            multiple
            hidden
            accept=".xlsx,.xls,.csv"
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = "";
              void start(files);
            }}
          />
        </div>
        <GhostChart />
      </div>
      {problem ? (
        <p role="alert" className="mt-2 type-meta text-destructive">
          {problem}
        </p>
      ) : null}
      <p className="mt-3 flex flex-wrap items-center gap-1.5 type-meta text-muted-foreground">
        {t.rich("byHand", {
          link: (chunks: ReactNode) => (
            <a href="/core/organization" className="font-medium text-foreground underline decoration-border underline-offset-[3px]">
              {chunks}
            </a>
          ),
        })}
      </p>
    </div>
  );
}

/** The chart the import will build, in the org chart's card language: the viewer at the top, room under them. */
function GhostChart() {
  const t = useTranslations("home.setup.drop");
  const { user } = useAuth();
  const card = useMyCard();
  const photo = usePhoto(card.data?.photoUrl);
  const company = useTenantSummary().data?.name ?? "";
  const name = card.data?.displayName ?? user?.fullName ?? company;
  return (
    <div className="grid justify-items-center" aria-hidden>
      <div className="w-[196px] rounded-control border border-primary-ring bg-card">
        <div className="flex min-w-0 items-center gap-2.5 px-3 py-[11px]">
          <PersonAvatar name={name} photo={photo} size="md" />
          <div className="min-w-0">
            <p className="truncate type-label">{name}</p>
            <p className="truncate type-meta text-muted-foreground">{t("you")}</p>
          </div>
        </div>
      </div>
      <div className="h-6 w-[1.5px] bg-input" />
      <div className="relative flex gap-3 pt-6 before:absolute before:inset-x-[98px] before:top-0 before:h-[1.5px] before:bg-input">
        {[0, 1, 2].map((slot) => (
          <div
            key={slot}
            className="relative w-[196px] rounded-control border-[1.5px] border-dashed border-input before:absolute before:-top-6 before:start-[calc(50%-0.75px)] before:h-6 before:w-[1.5px] before:bg-input"
          >
            <div className="flex items-center gap-2.5 px-3 py-[11px]">
              <span className="size-9 shrink-0 rounded-full border-[1.5px] border-dashed border-input" />
              <span className="grid flex-1 gap-[7px]">
                <i className="block h-[7px] rounded-full bg-inlay" />
                <i className="block h-[7px] w-3/5 rounded-full bg-inlay" />
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The company beside the guide: its mark large, its name, and its defaults as label over value. */
export function CompanyCard() {
  const t = useTranslations("home.setup.company");
  const locale = useLocale();
  const tenant = useTenantSummary();
  const data = tenant.data;
  const language = data?.language ? new Intl.DisplayNames([locale], { type: "language" }).of(data.language) : null;
  return (
    <section aria-label={t("label")} className="grid gap-5 rounded-surface bg-card p-[22px]">
      <div className="flex items-center gap-3.5">
        <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-control bg-primary font-editorial text-[30px] font-medium text-primary-foreground">
          {data?.logoUrl ? <Image src={data.logoUrl} alt="" width={64} height={64} unoptimized className="size-full bg-card object-contain" /> : data?.name?.trim().charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          {data ? <p className="line-clamp-2 break-words type-panel-title">{data.name}</p> : <Skeleton className="h-4 w-32" />}
          <p className="type-meta text-muted-foreground">{t("yours")}</p>
        </div>
        <Button asChild variant="ghost" size="sm" className="shrink-0 text-muted-foreground">
          <a href={STEP_HREF.company}>{t("edit")}</a>
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-x-[18px] gap-y-3.5">
        <Fact label={t("language")} value={language} />
        <Fact label={t("timeZone")} value={data?.timeZone?.split("/").pop()?.replace(/_/g, " ") ?? null} />
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="mb-0.5 type-meta text-muted-foreground">{label}</p>
      <p className="type-label">{value ?? "—"}</p>
    </div>
  );
}

/** People so far: the viewer first ("You"), the count beside the title. */
export function PeopleCard({ people }: { people: number }) {
  const t = useTranslations("home.setup.people");
  const { user } = useAuth();
  const card = useMyCard();
  const photo = usePhoto(card.data?.photoUrl);
  const name = card.data?.displayName ?? user?.fullName ?? "";
  return (
    <section aria-labelledby="people-title" className="grid gap-3.5 rounded-surface bg-card px-[22px] py-5">
      <div className="flex items-baseline justify-between">
        <h3 id="people-title" className="type-subsection-title">{t("title")}</h3>
        <span className="type-meta text-muted-foreground">{t("soFar", { count: people })}</span>
      </div>
      {user?.employeeId ? (
        <div className="flex items-center gap-3">
          <PersonAvatar name={name} photo={photo} size="lg" />
          <div className="min-w-0">
            <p className="type-label">
              {name}
              <span className="ms-1.5 rounded-full bg-primary-tint px-[7px] py-px text-[11px] font-semibold text-primary-ink">{t("you")}</span>
            </p>
            <p className="truncate type-meta text-muted-foreground">{card.data?.jobTitle ?? ""}</p>
          </div>
        </div>
      ) : null}
      {people > (user?.employeeId ? 1 : 0) ? (
        <a href="/core/people" className="type-meta font-medium text-foreground underline decoration-border underline-offset-[3px]">
          {t("open")}
        </a>
      ) : null}
    </section>
  );
}
