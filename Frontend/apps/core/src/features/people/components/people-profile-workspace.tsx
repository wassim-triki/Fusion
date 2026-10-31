"use client";

import { useSay } from "@repo/ds/lib/say";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import {
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  DatePicker,
  Input,
  Label,
} from "@repo/ds";
import { PageContainer, PageListSkeleton } from "@repo/ds/shell";
import { toast } from "sonner";
import { useBreadcrumbLabel } from "@/shell/breadcrumb-overrides";
import { useOrgChartAccess } from "@/features/org-chart/api/use-org-chart-access";
import {
  canAccessCorePeople,
  canAccessCoreTeam,
  canEnterPerformance,
  canManageCoreEmployees,
  canViewWorkforceAccess,
  useAuth,
} from "@repo/auth";
import { classifyApiError } from "@repo/api";
import {
  ArrowLeft,
  ArrowLeftRight,
  CalendarDays,
  Camera,
  Check,
  ChevronRight,
  MoreHorizontal,
  RotateCcw,
  ShieldAlert,
  UserRound,
  UserRoundPlus,
  UserRoundX,
  Workflow,
} from "lucide-react";
import {
  usePeopleAccessStatus,
  usePeopleJobHistory,
  usePeoplePersonal,
  usePeopleProfile,
  usePeopleTimeline,
  useUpdatePeopleWorkEmail,
} from "../api/use-people";
import { useWorkforceDate } from "./workforce-ui";
import { WorkerProfile } from "./worker-profile/worker-profile";
import { PerformanceRecordView } from "./record-views";
import { WorkerProfileSkeleton } from "./worker-profile/worker-profile-skeleton";
import { fromPeopleProfile } from "./worker-profile/worker-profile-view";
import { PersonRoles } from "@/features/settings/roles/person-roles";
import { AccessTab } from "./worker-profile/access-tab";
import { JobTab } from "./worker-profile/job-tab";
import { PersonalTab } from "./worker-profile/personal-tab";
import { PhotoDialog } from "./worker-profile/photo-dialog";
import { useProfileTabs } from "./worker-profile/profile-tabs";
import { useRecentRecord } from "@repo/api/react";
import { useChangeSheet } from "../changes/change-sheet";
import { usePendingRequestCards } from "@/features/changes/pending-requests";
import { ComingUpCard } from "../changes/coming-up";
import { DottedLines } from "../changes/dotted-lines";
import { useChangeRights } from "../changes/use-changes";

function isoDay(value: string): string {
  return value.length >= 10 ? value.slice(0, 10) : value;
}

export default function PeopleProfileWorkspace({ employeeKey }: { employeeKey: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const asOfParam = searchParams.get("asOf");

  const { user, isLoading: authLoading } = useAuth();
  const orgChart = useOrgChartAccess();
  const t = useTranslations("profile.record");
  const tPhoto = useTranslations("profile.band");
  const say = useSay("profile");
  const locale = useLocale();
  const workforceDate = useWorkforceDate();
  const canManage = canManageCoreEmployees(user);
  const rights = useChangeRights();
  const changeSheet = useChangeSheet(employeeKey);
  const tc = useTranslations("changes.menu");
  // Performance exists only where the viewer can enter it (hide, don't deny).
  const showPerformance = canEnterPerformance(user);
  // Managers and HR may see more than the directory; the Personal read says how much for this person.
  const canExplore = canAccessCoreTeam(user);
  const canSeeAccess = canAccessCorePeople(user);
  const mayExplore = canExplore || canSeeAccess || canManage;

  const profile = usePeopleProfile(employeeKey, asOfParam);
  const isSelf = Boolean(user?.employeeId) && user?.employeeId === profile.data?.identity.employeeId;
  const personal = usePeoplePersonal(employeeKey, Boolean(profile.data) && (mayExplore || isSelf));
  // A colleague outside the viewer's branch: header, rail and reporting line only.
  const directoryOnly = personal.data ? personal.data.access === "Directory" : !(mayExplore || isSelf);
  const tabsKnown = Boolean(personal.data) || personal.error != null || !(mayExplore || isSelf);
  const explores = tabsKnown && !directoryOnly;

  const { tab, tabs } = useProfileTabs({
    personal: true,
    performance: showPerformance,
    access: canSeeAccess,
  });
  const timeline = usePeopleTimeline(employeeKey, Boolean(profile.data) && explores && tab === "job");
  const jobHistory = usePeopleJobHistory(employeeKey, Boolean(profile.data) && explores && tab === "job");
  const access = usePeopleAccessStatus(employeeKey, Boolean(profile.data) && canSeeAccess && tab === "access");
  const managerKey = profile.data?.primaryManager?.employeeKey ?? "";
  const team = usePeopleProfile(explores && profile.data?.directReportCount === 0 ? managerKey : "", null);

  const [workEmailEditorOpen, setWorkEmailEditorOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const workEmailActionHandled = useRef(false);
  const requestedAction = searchParams.get("action");
  const returnTo =
    searchParams.get("returnTo") === "/core/workforce-access"
      ? "/core/workforce-access"
      : null;

  const established = searchParams.get("established");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [showResult, setShowResult] = useState(Boolean(established));
  useBreadcrumbLabel(employeeKey, profile.data?.identity.displayName);
  useRecentRecord(
    "core",
    profile.data
      ? { label: profile.data.identity.displayName, kind: "Person", href: `/core/people/${encodeURIComponent(employeeKey)}` }
      : null,
  );

  useEffect(() => {
    if (profile.data && established) headingRef.current?.focus();
  }, [established, profile.data]);

  useEffect(() => {
    if (!showResult) return;
    const timer = window.setTimeout(() => setShowResult(false), 6000);
    return () => window.clearTimeout(timer);
  }, [showResult]);

  useEffect(() => {
    if (requestedAction !== "work-email") {
      workEmailActionHandled.current = false;
      return;
    }
    if (
      workEmailActionHandled.current ||
      !profile.data ||
      !canManage ||
      profile.data.isAsOf
    ) {
      return;
    }

    workEmailActionHandled.current = true;
    setWorkEmailEditorOpen(true);
    const nextSearchParams = new URLSearchParams(searchParams.toString());
    nextSearchParams.delete("action");
    const nextSearch = nextSearchParams.toString();
    window.history.replaceState(
      window.history.state,
      "",
      nextSearch ? `${pathname}?${nextSearch}` : pathname
    );
  }, [canManage, pathname, profile.data, requestedAction, searchParams]);

  // Requests about this person that wait for an answer, for whoever approves, asked or can change (B-179).
  const managesThisPerson = Boolean(rights.employeeId) && profile.data?.primaryManager?.employeeId === rights.employeeId;
  const pendingRequests = usePendingRequestCards(employeeKey,
    Boolean(profile.data) && !profile.data?.isAsOf && (rights.approve || canManage || (rights.propose && managesThisPerson)));

  if (profile.isLoading || authLoading) return <WorkerProfileSkeleton showBackLink />;

  if (profile.error || !profile.data) {
    const kind = profile.error ? classifyApiError(profile.error) : "validation";
    if (kind === "auth") {
      return (
        <ProfileNotice
          icon={ShieldAlert}
          title={t("noAccess")}
          description={t("noAccessDescription")}
        />
      );
    }
    const transient = kind === "network" || kind === "upstream-unavailable";
    return (
      <ProfileNotice
        icon={UserRound}
        title={t("notFound")}
        description={transient ? t("transient") : t("missing")}
        onRetry={
          profile.error && (transient || kind === "unexpected")
            ? () => void profile.refetch()
            : undefined
        }
      />
    );
  }

  const employee = profile.data;
  const isAsOf = employee.isAsOf;
  const view = fromPeopleProfile(
    employee,
    timeline.data?.timeline,
    canSeeAccess ? (access.data ?? null) : null,
    { say, locale }
  );

  const isFormer = employee.employment.state === "Former";
  // Reporting admins change the line too; the panel shows them only the line and the team. A manager who may propose
  // changes describes one for their direct reports (B-179).
  const proposesHere = rights.propose && !canManage && managesThisPerson;
  const showActions = (rights.lines || proposesHere) && !isAsOf && (!isFormer || canManage);
  const orgChartHref = orgChart.canSee ? `/org-chart?focus=${encodeURIComponent(employeeKey)}` : undefined;
  const goAsOf = (date: string) => router.push(`${pathname}?asOf=${date}`);
  const returnToToday = () => router.push(tab === "job" ? pathname : `${pathname}?tab=${tab}`);

  const accessState = access.isLoading ? ("loading" as const) : access.error ? ("error" as const) : ("ready" as const);
  const canManageWorkEmail = canManage && !isAsOf;
  const accessAction =
    access.data && view.workEmail && canViewWorkforceAccess(user) ? (
      <Link
        href="/workforce-access"
        className="inline-block type-meta text-primary-ink underline-offset-4 hover:underline"
      >
        {access.data.state === "NoAccess" ? t("setUpAccess") : t("reviewAccess")}
      </Link>
    ) : undefined;
  const workEmailAction = canManageWorkEmail ? (
    <Button
      variant="link"
      className="h-auto p-0 type-meta text-primary-ink"
      onClick={() => setWorkEmailEditorOpen(true)}
    >
      {view.workEmail ? t("editWorkEmail") : t("addWorkEmail")}
      <ChevronRight className="ms-1 size-3.5 rtl:rotate-180" aria-hidden />
    </Button>
  ) : undefined;

  const jobHistoryForbidden = Boolean(jobHistory.error) && classifyApiError(jobHistory.error) === "auth";
  const timelineForbidden = Boolean(timeline.error) && classifyApiError(timeline.error) === "auth";
  const teammates = (team.data?.directReports ?? [])
    .filter((mate) => mate.employeeKey !== employeeKey)
    .map((mate) => ({ name: mate.displayName, href: `/people/${mate.employeeKey}`, jobTitle: mate.jobTitle, photoUrl: mate.photoUrl }));
  const canChangePhoto = !isAsOf && (canManage || (isSelf && personal.data?.canEdit === true));
  const hasDottedLines = employee.dottedLineManagers.length > 0 || (rights.lines && !isFormer);

  const body = !tabsKnown ? (
    <PageListSkeleton rows={4} />
  ) : directoryOnly ? undefined : tab === "personal" ? (
    <PersonalTab
      employeeKey={employeeKey}
      displayName={view.displayName}
      workEmail={view.workEmail}
      isSelf={isSelf}
    />
  ) : tab === "performance" ? (
    <PerformanceRecordView employeeId={employee.identity.employeeId} />
  ) : tab === "access" ? (
    <AccessTab
      view={view}
      state={accessState}
      onRetry={() => void access.refetch()}
      accessAction={accessAction}
      workEmailAction={workEmailAction}
      roles={<PersonRoles employeeId={employee.identity.employeeId} />}
    />
  ) : (
    <JobTab
      view={view}
      jobHistory={
        jobHistoryForbidden
          ? undefined
          : {
              rows: jobHistory.data?.rows,
              isLoading: jobHistory.isLoading,
              failed: Boolean(jobHistory.error),
              retry: () => void jobHistory.refetch(),
            }
      }
      timeline={timelineForbidden ? undefined : { events: view.timeline, isLoading: timeline.isLoading }}
      dottedLines={!isAsOf && hasDottedLines ? <DottedLines person={employee} canEdit={rights.lines && !isFormer} /> : undefined}
      comingUp={
        !isAsOf && (employee.comingUp.length > 0 || pendingRequests.cards.length > 0 || showActions)
          ? [
              ...pendingRequests.cards,
              ...employee.comingUp.map((change) => (
                <ComingUpCard key={change.id} change={change} canChange={change.details.isReportingOnly ? rights.lines : rights.people} onEdit={changeSheet.edit} />
              )),
            ]
          : undefined
      }
      onSchedule={showActions && !isFormer ? () => changeSheet.start(employeeKey, "job") : undefined}
    />
  );

  return (
    <>
      <div role="status" aria-live="polite" className="sr-only">
        {established
          ? established === "hire"
            ? t("hiredAnnouncement")
            : t("addedAnnouncement")
          : ""}
      </div>
      <WorkerProfile
        view={view}
        headingRef={headingRef}
        orgChartHref={orgChartHref}
        tabs={explores ? tabs : undefined}
        currentTab={tab}
        teammates={teammates}
        backLink={
          <Link
            href="/people"
            className="inline-flex items-center gap-2 type-body text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:rounded-control focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="size-4 rtl:rotate-180" /> {t("back")}
          </Link>
        }
        nameBadge={
          showResult && established ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success-subtle px-2.5 py-1 type-meta font-medium text-foreground animate-in fade-in">
              <Check className="size-3.5 text-success" aria-hidden />
              {established === "hire" ? t("hired") : t("added")}
            </span>
          ) : undefined
        }
        photoAction={
          canChangePhoto ? (
            <Button size="icon" variant="outline" className="size-9 rounded-full bg-popover shadow-raised" aria-label={tPhoto("changePhoto")} onClick={() => setPhotoOpen(true)}>
              <Camera className="size-4" aria-hidden />
            </Button>
          ) : undefined
        }
        headerActions={
          isAsOf || (explores && canExplore) || showActions ? (
            <>
              {isAsOf ? (
                <div className="inline-flex items-center gap-2.5 rounded-full border border-primary/30 bg-primary/[0.06] py-1.5 ps-3.5 pe-1.5 animate-in fade-in">
                  <span className="type-label">
                    {t("asOf", { date: workforceDate(employee.viewedDate, { month: "long" }) })}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 rounded-full px-2.5 text-muted-foreground hover:text-foreground"
                    onClick={returnToToday}
                  >
                    <RotateCcw className="size-3.5" /> {t("today")}
                  </Button>
                </div>
              ) : explores && canExplore ? (
                <AsOfControl
                  today={isoDay(employee.viewedDate)}
                  onPick={goAsOf}
                />
              ) : null}
              {showActions ? (
                <div className="flex items-center gap-2">
                  {isFormer ? (
                    <Button size="sm" variant="outline" onClick={() => changeSheet.start(employeeKey, "start")}>
                      <UserRoundPlus className="size-4" /> {tc("startEmployment")}
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => changeSheet.start(employeeKey, "job")}>
                      <ArrowLeftRight className="size-4" /> {canManage ? tc("makeChange") : proposesHere ? tc("propose") : tc("changeManager")}
                    </Button>
                  )}
                  {canManage && !isFormer ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="outline" aria-label={tc("more")}>
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {orgChartHref ? (
                          <DropdownMenuItem asChild>
                            <Link href={orgChartHref}><Workflow className="size-4" /> {tc("showInChart")}</Link>
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => changeSheet.start(employeeKey, "end")}
                        >
                          <UserRoundX className="size-4" /> {tc("endEmployment")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : undefined
        }
      >
        {body}
      </WorkerProfile>
      {changeSheet.element}
      {pendingRequests.sheet}
      {canChangePhoto ? (
        <PhotoDialog
          open={photoOpen}
          onOpenChange={setPhotoOpen}
          employeeKey={employeeKey}
          displayName={view.displayName}
          photoUrl={view.photoUrl}
          isSelf={isSelf}
        />
      ) : null}
      <WorkEmailEditorDialog
        open={workEmailEditorOpen}
        onOpenChange={setWorkEmailEditorOpen}
        employeeKey={employeeKey}
        displayName={employee.identity.displayName}
        employeeNumber={employee.identity.employeeNumber}
        currentEmail={employee.identity.workEmail}
        expectedVersion={employee.version}
        returnTo={returnTo}
      />
    </>
  );
}

function ProfileNotice({
  icon: Icon,
  title,
  description,
  onRetry,
}: {
  icon: typeof UserRound;
  title: string;
  description: string;
  onRetry?: () => void;
}) {
  const t = useTranslations("profile.record");
  return (
    <PageContainer>
      <Empty className="min-h-[26rem] rounded-surface border">
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyHeader>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/people">
                <ArrowLeft className="size-4" /> {t("backToPeople")}
              </Link>
            </Button>
            {onRetry ? (
              <Button variant="ghost" onClick={onRetry}>
                <RotateCcw className="size-4" /> {t("retry")}
              </Button>
            ) : null}
          </div>
        </EmptyContent>
      </Empty>
    </PageContainer>
  );
}

/** Quiet Today-only affordance to view the worker as of another date. */
function AsOfControl({
  today,
  onPick,
}: {
  today: string;
  onPick: (date: string) => void;
}) {
  const t = useTranslations("profile.record");
  return (
    <div className="inline-flex items-center gap-2 type-body text-muted-foreground">
      <CalendarDays className="size-4" aria-hidden />
      <span className="type-label">{t("asOfToday")}</span>
      <span aria-hidden className="text-muted-foreground/40">
        ·
      </span>
      <DatePicker value={today} onChange={onPick} aria-label={t("viewAsOfDate")} className="h-8 w-auto" />
    </div>
  );
}

function WorkEmailEditorDialog({
  open,
  onOpenChange,
  employeeKey,
  displayName,
  employeeNumber,
  currentEmail,
  expectedVersion,
  returnTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeKey: string;
  displayName: string;
  employeeNumber: string;
  currentEmail: string | null;
  expectedVersion: number;
  returnTo: string | null;
}) {
  const router = useRouter();
  const t = useTranslations("profile.workEmail");
  const english = useLocale() === "en";
  const record = useTranslations("profile.record");
  const editTitle = record("editWorkEmail");
  const addTitle = record("addWorkEmail");
  const updateWorkEmail = useUpdatePeopleWorkEmail(employeeKey);
  const [draft, setDraft] = useState(currentEmail ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(currentEmail ?? "");
    setError(null);
  }, [currentEmail, open]);

  async function handleSubmit() {
    const workEmail = draft.trim().toLowerCase();
    if (!workEmail) {
      setError(t("required"));
      return;
    }

    setError(null);
    try {
      await updateWorkEmail.mutateAsync({ workEmail, expectedVersion });
      toast.success(currentEmail ? t("updated") : t("added"));
      onOpenChange(false);
      if (returnTo) router.push(returnTo);
    } catch (mutationError) {
      setError(
        english && mutationError instanceof Error && mutationError.message.trim()
          ? mutationError.message
          : t("failed")
      );
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!updateWorkEmail.isLoading) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>
            {currentEmail ? editTitle : addTitle}
          </DialogTitle>
        </DialogHeader>

        <form
          className="space-y-5 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="rounded-surface border bg-inlay px-4 py-3">
            <p className="type-label">{displayName}</p>
            <p className="mt-1 type-code text-muted-foreground">
              {employeeNumber}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="people-work-email">{t("label")}</Label>
            <Input
              id="people-work-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={updateWorkEmail.isLoading}
              placeholder={t("placeholder")}
              aria-invalid={error ? true : undefined}
            />
            <p className="type-meta text-muted-foreground">
              {t("hint")}
            </p>
          </div>

          {error ? (
            <p
              className="rounded-control bg-danger/10 px-3 py-2 type-meta font-medium text-danger"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={updateWorkEmail.isLoading}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!draft.trim() || updateWorkEmail.isLoading}
            >
              {updateWorkEmail.isLoading ? t("saving") : t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
