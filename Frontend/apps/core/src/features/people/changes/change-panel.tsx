"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { QuickPicks } from "@repo/ds/choice";
import { Button, DatePicker, Skeleton, Spinner, Textarea, cn } from "@repo/ds";
import { StatusBadge } from "@repo/ds/shell";
import { useFormat } from "@repo/ds/lib/use-format";
import type {
  ChangeApprovalType,
  ChangePersonRef,
  ManagerOptionDto,
  PeopleProfileDto,
  WorkforceChangeDto,
} from "@repo/api";
import { Check, MessageSquare, PenLine, Sparkles, Stamp, Target, X } from "lucide-react";
import { useRefusal } from "@/i18n/words";
import { JobPicker, PlacePicker } from "@/features/catalog/components/catalog-pickers";
import { useCompanyLists, useJobs } from "@/features/catalog/api/use-catalog";
import { useOrganizationHierarchy } from "@/features/organization/api/use-organization";
import { usePeopleProfile } from "../api/use-people";
import { ManagerPicker, OrganizationPicker, flattenOrg } from "../components/workforce-pickers";
import { Monogram } from "../components/workforce-ui";
import {
  useApprovalSettings,
  useCancelChange,
  useChangeDraft,
  useChangeMutations,
  useChangeRights,
  useProposeChange,
  useEndEmploymentPreview,
  useLineEffects,
  useManagerOptions,
} from "./use-changes";

export type ChangeKind = "job" | "end" | "start";

/** What the chart previews while the panel is open: where the person (and their team) will sit. */
export interface ChangeDraft {
  managerKey: string | null;
  teamManagerKey: string | null;
}

const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const todayIso = () => iso(new Date());
const firstOfNextMonth = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth() + 1, 1)); };
const lastOfMonth = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)); };
const addDay = (value: string) => { const [y, m, d] = value.split("-").map(Number); return iso(new Date(y!, m! - 1, d! + 1)); };
const firstName = (name: string) => name.split(" ")[0] ?? name;

/**
 * One panel for every change to a person, opened where they are: a sheet on the profile and People, the person
 * panel's slot on the chart. It shows the result before saving, and saving names its date.
 */
export function ChangePanel({
  employeeKey, kind, editing, initialManagerKey, onClose, onDraft,
}: {
  employeeKey: string;
  kind: ChangeKind;
  /** A scheduled change to replace; its values fill the panel. */
  editing?: WorkforceChangeDto | null;
  /** The manager a chart drop chose. */
  initialManagerKey?: string | null;
  onClose: () => void;
  onDraft?: (draft: ChangeDraft) => void;
}) {
  const profile = usePeopleProfile(employeeKey);
  const t = useTranslations("changes");
  const rights = useChangeRights();
  const person = profile.data;
  const title = kind === "end" ? t("kind.end") : kind === "start" ? t("kind.start")
    : rights.people || rights.propose ? t("kind.change") : t("kind.manager");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-start gap-3.5 border-b px-[22px] pb-4 pt-5">
        {person ? <Monogram name={person.identity.displayName} size="lg" /> : <Skeleton className="size-11 rounded-full" />}
        <div className="min-w-0 flex-1">
          <p className="type-meta text-muted-foreground">{title}</p>
          <h2 className="truncate text-lg font-semibold leading-snug">{person?.identity.displayName ?? <Skeleton className="h-5 w-40" />}</h2>
          {person ? (
            <p className="truncate type-meta text-muted-foreground">
              {kind === "start"
                ? t("start.former", { title: person.work?.jobTitle ?? "" })
                : [person.work?.jobTitle, person.work?.organizationName].filter(Boolean).join(", ")}
            </p>
          ) : null}
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("close")} onClick={onClose}><X className="size-4" /></Button>
      </header>
      {!person ? (
        <div className="grid gap-3 p-[22px]"><Skeleton className="h-12" /><Skeleton className="h-24" /><Skeleton className="h-10" /></div>
      ) : kind === "end" ? (
        <EndForm person={person} editing={editing ?? null} onClose={onClose} />
      ) : kind === "start" ? (
        <StartForm person={person} editing={editing ?? null} onClose={onClose} />
      ) : (
        <JobForm person={person} editing={editing ?? null} initialManagerKey={initialManagerKey ?? null} onClose={onClose} onDraft={onDraft} reportingOnly={!rights.people && !rights.propose} />
      )}
    </div>
  );
}

// --- Job change -----------------------------------------------------------------------------------

type Fact = "unit" | "title" | "location" | "reason";
type Picked = { id: string; name: string };

/**
 * A change of job, described in a sentence and drafted from the company's own jobs and reasons (D-15): the draft is
 * the request, each part editable. HR's changes apply on their date; a manager's waits for approval when the company
 * asks for it on that type of change.
 */
function JobForm({
  person, editing, initialManagerKey, onClose, onDraft, reportingOnly,
}: {
  person: PeopleProfileDto;
  editing: WorkforceChangeDto | null;
  initialManagerKey: string | null;
  onClose: () => void;
  onDraft?: (draft: ChangeDraft) => void;
  reportingOnly: boolean;
}) {
  const t = useTranslations("changes");
  const format = useFormat();
  const refusal = useRefusal();
  const rights = useChangeRights();
  const key = person.identity.employeeKey;
  const employeeId = person.identity.employeeId;
  const { changeJob, editChange } = useChangeMutations(key);
  const propose = useProposeChange(key);
  const draft = useChangeDraft(key);
  const cancel = useCancelChange();
  const d = editing?.details;
  // HR and proposers go through the one door that decides whether it waits; edits and reporting admins keep theirs.
  const describes = !editing && (rights.people || rights.propose);

  const [date, setDate] = useState(editing?.effectiveDate ?? todayIso());
  const [chosen, setChosen] = useState<ChangePersonRef | null>(d?.managerChanged ? d.managerTo : null);
  const [noManager, setNoManager] = useState(Boolean(d?.managerChanged && !d.managerTo));
  const [teamStays, setTeamStays] = useState(d?.teamOutcome === "Stays");
  const [teamManager, setTeamManager] = useState<ChangePersonRef | null>(d?.teamOutcome === "Stays" ? d.teamManager : null);
  const [unit, setUnit] = useState<{ id: string; name: string } | null>(d?.unitChanged && d.unitToId ? { id: d.unitToId, name: d.unitTo ?? "" } : null);
  // An edit starts from the change's picks; undefined is "unchanged", a null place is "no place".
  const [job, setJob] = useState<(Picked & { level?: string | null }) | null>(d?.titleChanged && d.jobToId ? { id: d.jobToId, name: d.titleTo ?? "" } : null);
  const [place, setPlace] = useState<Picked | null | undefined>(
    d?.locationChanged ? (d.placeToId ? { id: d.placeToId, name: d.locationTo ?? "" } : null) : undefined);
  const [reasonId, setReasonId] = useState<string | null>(d?.reasonId ?? null);
  const [note, setNote] = useState(editing?.note ?? "");
  const [said, setSaid] = useState("");
  const [read, setRead] = useState<"ai" | "words" | "nothing" | "leaving" | null>(null);
  const [open, setOpen] = useState<Fact | null>(null);
  const [error, setError] = useState<string | null>(null);

  const approvals = useApprovalSettings(describes);
  const lists = useCompanyLists(describes);
  const jobs = useJobs(describes);
  const reasons = (lists.data?.find((list) => list.id === "change-reasons")?.values ?? []).filter((value) => !value.isRetired || value.id === reasonId);

  // A chart drop names the new manager by key; look them up once.
  const dropped = useManagerOptions(date, initialManagerKey ?? "", employeeId);
  useEffect(() => {
    if (!initialManagerKey || chosen) return;
    const match = dropped.data?.find((option) => option.employeeKey === initialManagerKey);
    if (match) setChosen(toRef(match));
  }, [initialManagerKey, dropped.data, chosen]);

  const current = person.primaryManager;
  const work = person.work;
  const managerChanged = noManager ? Boolean(current) : Boolean(chosen && chosen.employeeKey !== current?.employeeKey);
  const unitChanged = Boolean(unit && unit.id !== work?.orgUnitId);
  const titleChanged = job !== null && job.id !== work?.jobId;
  const locationChanged = place !== undefined && (place?.id ?? null) !== (work?.placeId ?? null);
  const anything = managerChanged || unitChanged || titleChanged || locationChanged;
  const teamShown = person.directReportCount > 0 && (managerChanged || unitChanged);
  const isToday = date === todayIso();

  const levelOf = (jobId: string | null | undefined) => jobs.data?.find((item) => item.id === jobId)?.level?.label ?? null;
  const levelFrom = levelOf(work?.jobId);
  const levelTo = titleChanged ? (job?.level ?? levelOf(job?.id)) : null;

  // The parts of this change the company wants approved; HR's own never wait.
  const touched: ChangeApprovalType[] = [
    ...(unitChanged || titleChanged ? (["job"] as const) : []),
    ...(managerChanged || (teamShown && teamStays) ? (["manager"] as const) : []),
    ...(locationChanged ? (["place"] as const) : []),
  ];
  const required = new Set(approvals.data?.types.filter((type) => type.required).map((type) => type.type) ?? []);
  const waiting = touched.filter((type) => required.has(type));
  const waits = describes && !rights.people && waiting.length > 0;
  const approvers = (approvals.data?.approvers ?? []).filter((approver) => approver.employeeId !== rights.employeeId);

  useEffect(() => {
    onDraft?.({
      managerKey: managerChanged ? (noManager ? null : chosen?.employeeKey ?? null) : current?.employeeKey ?? null,
      teamManagerKey: teamShown && teamStays ? (teamManager?.employeeKey ?? current?.employeeKey ?? null) : null,
    });
  }, [onDraft, managerChanged, noManager, chosen, current, teamShown, teamStays, teamManager]);

  const effects = useLineEffects(employeeId, noManager ? null : chosen?.employeeId ?? null, managerChanged);
  const dottedEnds = chosen && person.dottedLineManagers.some((line) => line.employeeKey === chosen.employeeKey) ? chosen : null;

  const readIt = async () => {
    setError(null);
    try {
      const result = await draft.mutateAsync(said.trim());
      if (result.kind === "end") { setRead("leaving"); return; }
      if (!result.understood) { setRead("nothing"); return; }
      if (result.date) setDate(result.date);
      if (result.jobId && result.jobId !== work?.jobId) setJob({ id: result.jobId, name: result.jobTitle ?? "", level: result.jobLevel });
      if (result.orgUnitId && result.orgUnitId !== work?.orgUnitId) setUnit({ id: result.orgUnitId, name: result.orgUnitName ?? "" });
      if (result.placeId && result.placeId !== work?.placeId) setPlace({ id: result.placeId, name: result.placeName ?? "" });
      if (result.reasonId) setReasonId(result.reasonId);
      setRead(result.usedAi ? "ai" : "words");
    } catch (caught) {
      setError(refusal(caught, t("describe.failed")));
    }
  };

  const save = async () => {
    setError(null);
    const request = {
      effectiveDate: date,
      managerEmployeeId: managerChanged && !noManager ? chosen?.employeeId ?? null : null,
      removeManager: managerChanged && noManager,
      team: teamShown ? { stays: teamStays, managerEmployeeId: teamStays ? teamManager?.employeeId ?? null : null } : null,
      orgUnitId: unitChanged ? unit!.id : null,
      jobId: titleChanged ? job!.id : null,
      placeId: locationChanged ? place?.id ?? null : null,
      removePlace: locationChanged && place === null,
      reasonId,
      note: note.trim() || null,
    };
    try {
      if (describes) {
        const result = await propose.mutateAsync({ job: request, description: said.trim() || null });
        if (result.request) toast.success(t("request.sent", { name: firstName(person.identity.displayName) }));
        else if (result.change) announce(result.change);
      } else {
        announce(editing
          ? await editChange.mutateAsync({ id: editing.id, request: { job: request } })
          : await changeJob.mutateAsync(request));
      }
      onClose();
    } catch (caught) {
      setError(refusal(caught, t("failed")));
    }
  };

  const announce = (saved: WorkforceChangeDto) => {
    if (!isToday) { toast.success(t("saved.scheduled", { date: format.date(date) })); return; }
    const message = saved.details.managerChanged && saved.details.managerTo
      ? t("saved.job", { name: person.identity.displayName, manager: saved.details.managerTo.displayName })
      : t("saved.jobOnly", { name: person.identity.displayName });
    toast.success(message, { action: { label: t("saved.undo"), onClick: () => void cancel.mutateAsync(saved.id).then(() => toast.success(t("saved.undone"))) } });
  };

  const summary = waits
    ? t.rich("summary.onceApproved", { date: format.date(date), b })
    : teamShown && teamStays
      ? t.rich("summary.withTeam", { name: firstName(person.identity.displayName), count: person.directReportCount, date: format.date(date), b })
      : isToday ? t.rich("summary.today", { b }) : t.rich("summary.scheduled", { date: format.date(date), b });
  const busy = changeJob.isLoading || editChange.isLoading || propose.isLoading;

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-[22px] pb-4 pt-1.5">
        {describes ? (
          <section className="py-3.5">
            <div className="grid gap-2 rounded-inset border bg-inlay p-3.5 focus-within:ring-2 focus-within:ring-ring">
              <label htmlFor="change-say" className="type-meta text-muted-foreground">{t("describe.label")}</label>
              <Textarea
                id="change-say"
                value={said}
                onChange={(event) => { setSaid(event.target.value); setRead(null); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && said.trim()) { event.preventDefault(); void readIt(); }
                }}
                placeholder={t("describe.placeholder", { name: firstName(person.identity.displayName) })}
                rows={2}
                maxLength={400}
                className="min-h-[44px] resize-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
              />
              <div className="flex items-center justify-end gap-2.5">
                {read ? (
                  <span role="status" className={cn("me-auto type-meta", read === "nothing" || read === "leaving" ? "text-warning" : "text-muted-foreground")}>
                    {read === "ai" ? <Sparkles aria-hidden className="me-1 inline size-3.5 align-[-2px] text-primary" /> : null}
                    {t(`describe.read.${read}`)}
                  </span>
                ) : null}
                <Button type="button" size="sm" variant="outline" disabled={!said.trim() || draft.isLoading} onClick={() => void readIt()}>
                  {draft.isLoading ? <Spinner className="size-3.5" /> : <PenLine className="size-3.5" />}
                  {draft.isLoading ? t("describe.drafting") : t("describe.draft")}
                </Button>
              </div>
            </div>
          </section>
        ) : null}

        {reportingOnly ? null : (
          <Block title={describes ? t("describe.theChange") : t("facts.title")}>
            <div key={read ?? "none"} className={cn("grid", (read === "ai" || read === "words") && "animate-in fade-in-0 slide-in-from-top-1 duration-300")}>
              <FactRow label={describes ? t("facts.title") : t("facts.jobTitle")} current={work?.jobTitle ?? t("facts.none")} next={titleChanged ? job!.name : null}
                open={open === "title"} onOpen={() => setOpen("title")} onUndo={() => { setJob(null); setOpen(null); }} onDone={() => setOpen(null)}>
                <JobPicker value={job?.id ?? work?.jobId ?? null} onChange={(next) => { setJob({ id: next.id, name: next.title, level: next.level?.label ?? null }); setOpen(null); }} />
              </FactRow>
              {titleChanged && levelTo && levelFrom !== levelTo ? (
                <FactRow fixed label={t("facts.level")} current={levelFrom ?? t("facts.none")} next={levelTo} open={false} onOpen={() => undefined} onUndo={() => undefined}>
                  {null}
                </FactRow>
              ) : null}
              <FactRow label={t("facts.unit")} current={work?.organizationName ?? t("facts.none")} next={unitChanged ? unit!.name : null}
                open={open === "unit"} onOpen={() => setOpen("unit")} onUndo={() => { setUnit(null); setOpen(null); }}>
                <UnitEditor date={date} value={unit?.id ?? work?.orgUnitId ?? ""} onChange={(next) => { setUnit(next); setOpen(null); }} />
              </FactRow>
              <FactRow label={t("facts.location")} current={work?.location ?? t("facts.none")} next={locationChanged ? (place?.name ?? t("facts.none")) : null}
                open={open === "location"} onOpen={() => setOpen("location")} onUndo={() => { setPlace(undefined); setOpen(null); }} onDone={() => setOpen(null)}>
                <PlacePicker value={place === undefined ? work?.placeId ?? null : place?.id ?? null}
                  onChange={(next) => { setPlace(next ? { id: next.id, name: next.name } : null); setOpen(null); }} />
              </FactRow>
              {describes && reasons.length > 0 ? (
                <FactRow label={t("facts.reason")} current={reasons.find((value) => value.id === reasonId)?.label ?? t("facts.none")} next={null}
                  open={open === "reason"} onOpen={() => setOpen("reason")} onUndo={() => undefined} onDone={() => setOpen(null)}>
                  <QuickPicks
                    label={t("facts.reason")}
                    value={reasonId ?? ""}
                    onPick={(value) => { setReasonId(value === reasonId ? null : value); setOpen(null); }}
                    options={reasons.map((value) => ({ value: value.id, label: value.label }))}
                  />
                </FactRow>
              ) : null}
              {describes ? (
                <div className="grid min-h-[34px] grid-cols-[84px_minmax(0,1fr)] items-center gap-2.5 py-1">
                  <span className="type-meta text-muted-foreground">{t("when.from")}</span>
                  <DateChoice label={t("when.from")} value={date} onChange={setDate} options={[todayIso(), firstOfNextMonth()]} />
                </div>
              ) : null}
            </div>
          </Block>
        )}

        <Block title={t("reportsTo")}>
          <div className={cn(current && "grid grid-cols-[18px_minmax(0,1fr)] gap-x-2.5")}>
            {current ? <Rail /> : null}
            {current ? (
              <div className="flex min-h-[46px] items-center gap-2.5 opacity-55">
                <Monogram name={current.displayName} size="md" />
                <span className="min-w-0 truncate type-label font-medium">{current.displayName}</span>
              </div>
            ) : null}
            {noManager ? (
              <div className="flex min-h-[46px] items-center justify-between gap-3 rounded-control border px-3">
                <span className="type-label">{t("noManager")}</span>
                <Button type="button" size="sm" variant="ghost" onClick={() => setNoManager(false)}>{t("facts.undo")}</Button>
              </div>
            ) : (
              <PersonPicker date={date} forEmployee={employeeId} value={chosen} onChange={(next) => { setChosen(next); setNoManager(false); }} />
            )}
          </div>
          {current && !noManager ? (
            <button type="button" className="justify-self-start type-meta text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={() => { setNoManager(true); setChosen(null); }}>
              {t("chooseNoManager")}
            </button>
          ) : null}
        </Block>

        {teamShown ? (
          <Block title={t("team.title", { name: firstName(person.identity.displayName) })} aside={t("team.count", { count: person.directReportCount })}>
            <div className="grid gap-2">
              <Option on={!teamStays} onSelect={() => setTeamStays(false)} label={t("team.along", { name: firstName(person.identity.displayName) })}>
                {!teamStays ? (
                  <div className="mt-1.5 flex items-center gap-2.5">
                    <Stack names={person.directReports.map((report) => report.displayName)} />
                    <span className="type-meta text-muted-foreground">
                      {person.directReportCount > 3
                        ? t("team.names", { names: person.directReports.slice(0, 3).map((r) => firstName(r.displayName)).join(", "), count: person.directReportCount - 3 })
                        : person.directReports.map((r) => firstName(r.displayName)).join(", ")}
                    </span>
                  </div>
                ) : null}
              </Option>
              <Option on={teamStays} onSelect={() => setTeamStays(true)} label={work ? t("team.stays", { unit: work.organizationName }) : t("team.staysNoUnit")}>
                {teamStays ? (
                  <div className="mt-1 grid gap-1">
                    <span className="type-meta text-muted-foreground">{t("team.reportsTo")}</span>
                    <PersonPicker
                      date={date}
                      value={teamManager ?? (current ? { employeeId: "", employeeKey: current.employeeKey, displayName: current.displayName } : null)}
                      onChange={setTeamManager}
                      excludeKey={person.identity.employeeKey}
                    />
                  </div>
                ) : null}
              </Option>
            </div>
          </Block>
        ) : null}

        {describes && !reportingOnly ? null : (
          <WhenBlock label={t("when.from")} value={date} onChange={setDate} options={[todayIso(), firstOfNextMonth()]} />
        )}

        {managerChanged && (effects.data?.reviewersStay.length || effects.data?.oneOnOnesEnd.length || dottedEnds) ? (
          <Block title={t("effects.title")} aside={effects.data?.reviewersStay.length || effects.data?.oneOnOnesEnd.length ? t("effects.performance") : undefined}>
            <div className="grid gap-2">
              {effects.data?.reviewersStay.map((item) => (
                <Effect key={item.cycleId} icon={<Target className="size-[15px]" />}>
                  {t.rich("effects.reviewerStays", { cycle: item.cycleName, name: item.reviewerName, b })}
                </Effect>
              ))}
              {effects.data?.oneOnOnesEnd.map((item) => (
                <Effect key={item.seriesId} icon={<MessageSquare className="size-[15px]" />}>
                  {t("effects.oneOnOnesEnd", { name: item.managerName, when: isToday ? t("effects.endsToday") : t("effects.endsOn", { date: format.date(date) }) })}
                </Effect>
              ))}
              {dottedEnds ? <Effect icon={<DottedMark />}>{t("effects.dottedEnds", { name: dottedEnds.displayName })}</Effect> : null}
            </div>
          </Block>
        ) : null}

        {describes ? (
          <Block>
            <label htmlFor="change-note" className="type-label font-semibold">
              {waits && approvers[0] ? t("request.noteFor", { name: firstName(approvers[0].displayName) }) : t("request.note")}{" "}
              <span className="font-normal text-muted-foreground">{t("request.optional")}</span>
            </label>
            <Textarea id="change-note" value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={1000} className="resize-none" />
          </Block>
        ) : null}

        {waits ? (
          <div className="mt-1 flex items-center gap-3 rounded-inset border bg-inlay px-3.5 py-3 animate-in fade-in-0 duration-300">
            {approvers.length ? (
              <span className="flex shrink-0">
                {approvers.slice(0, 3).map((approver, index) => (
                  <Monogram key={`${approver.displayName}-${index}`} name={approver.displayName} size="md" className={cn("ring-2 ring-inlay", index > 0 && "-ms-2")} />
                ))}
              </span>
            ) : (
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted"><Stamp className="size-4 text-muted-foreground" /></span>
            )}
            <div className="min-w-0 flex-1">
              <p className="type-label font-semibold">
                {approvers.length === 0 ? t("request.approverUnknown")
                  : approvers.length === 1 ? t("request.approver", { name: approvers[0]!.displayName })
                  : t("request.approvers", { name: approvers[0]!.displayName, count: approvers.length - 1 })}
              </p>
              <p className="type-meta text-muted-foreground">{t("request.why", { types: waiting.map((type) => t(`types.${type}`)).join(", ") })}</p>
            </div>
            <Check aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </div>
        ) : null}

        {error ? <p role="alert" className="pt-2 type-body text-destructive">{error}</p> : null}
      </div>
      <Footer summary={summary}>
        <Button type="button" variant="ghost" onClick={onClose}>{t("action.cancel")}</Button>
        <Button type="button" disabled={!anything || (noManager === false && managerChanged && !chosen) || busy} onClick={() => void save()}>
          {waits ? t("request.send") : isToday ? t("action.save") : t("action.schedule", { date: format.date(date) })}
        </Button>
      </Footer>
    </>
  );
}

// --- End of employment ----------------------------------------------------------------------------

function EndForm({ person, editing, onClose }: { person: PeopleProfileDto; editing: WorkforceChangeDto | null; onClose: () => void }) {
  const t = useTranslations("changes");
  const format = useFormat();
  const refusal = useRefusal();
  const key = person.identity.employeeKey;
  const { endEmployment, editChange } = useChangeMutations(key);
  const [lastDay, setLastDay] = useState(editing?.details.lastDay ?? lastOfMonth());
  const [bulk, setBulk] = useState<ChangePersonRef | null | undefined>(undefined);
  const [overrides, setOverrides] = useState<Record<string, ChangePersonRef | "none">>(() =>
    Object.fromEntries((editing?.details.reassigned ?? []).map((item) => [item.person.employeeId, item.manager ?? "none"])));
  const [noteOpen, setNoteOpen] = useState(Boolean(editing?.note));
  const [note, setNote] = useState(editing?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const preview = useEndEmploymentPreview(key, lastDay);
  const reports = preview.data?.reports ?? [];
  const toMove = reports.filter((report) => report.outcome === "Reassign");
  const target = bulk === undefined ? preview.data?.defaultManager ?? null : bulk;
  const targetOf = (id: string) => overrides[id] ?? target;
  const missing = toMove.some((report) => !targetOf(report.person.employeeId));
  const boundary = addDay(lastDay);

  const save = async () => {
    setError(null);
    const request = {
      lastDay,
      note: note.trim() || null,
      reports: toMove.map((report) => {
        const to = targetOf(report.person.employeeId);
        return { employeeId: report.person.employeeId, managerEmployeeId: to && to !== "none" ? to.employeeId : null };
      }),
    };
    try {
      if (editing) await editChange.mutateAsync({ id: editing.id, request: { end: request } });
      else await endEmployment.mutateAsync(request);
      toast.success(t("saved.ended", { name: person.identity.displayName, date: format.date(lastDay) }));
      onClose();
    } catch (caught) {
      setError(refusal(caught, t("failed")));
    }
  };

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-[22px] pb-4 pt-1.5">
        <WhenBlock label={t("when.lastDay")} value={lastDay} onChange={setLastDay} options={[todayIso(), lastOfMonth()]} />

        {preview.isLoading ? <div className="py-3"><Skeleton className="h-24" /></div> : reports.length ? (
          <Block title={t("end.reportsGoTo")} aside={toMove.length > 1 ? (
            <div className="w-44"><PersonPicker compact date={boundary} value={target} onChange={setBulk} excludeKey={key} /></div>
          ) : undefined}>
            <div>
              {reports.map((report) => (
                <div key={report.person.employeeId} className="group grid min-h-12 grid-cols-[minmax(0,1fr)_176px] items-center gap-2.5 border-b py-1.5 last:border-b-0">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Monogram name={report.person.displayName} size="md" />
                    <div className="min-w-0">
                      <p className="truncate type-label font-semibold">{report.person.displayName}</p>
                      <p className="truncate type-meta text-muted-foreground">
                        {report.outcome === "LeavesFirst" && report.outcomeDate ? t("end.leaves", { date: format.date(report.outcomeDate) })
                          : report.outcome === "MovesFirst" && report.outcomeDate ? t("end.moves", { date: format.date(report.outcomeDate) })
                          : report.directReportCount ? t("end.withTeam", { count: report.directReportCount })
                          : report.jobTitle}
                      </p>
                    </div>
                  </div>
                  {report.outcome === "Reassign" ? (
                    targetOf(report.person.employeeId) === "none" ? (
                      <div className="flex min-h-[34px] items-center justify-between gap-2 rounded-control border px-2.5 text-[13px]">
                        <span className="text-muted-foreground">{t("noManager")}</span>
                        <Button type="button" size="sm" variant="ghost" className="h-6 px-1.5"
                          onClick={() => setOverrides(({ [report.person.employeeId]: _dropped, ...rest }) => rest)}>{t("facts.undo")}</Button>
                      </div>
                    ) : (
                      <PersonPicker
                        compact
                        allowNone
                        date={boundary}
                        forEmployee={report.person.employeeId}
                        value={(targetOf(report.person.employeeId) as ChangePersonRef | null) ?? null}
                        onChange={(next) => setOverrides((all) => ({ ...all, [report.person.employeeId]: next ?? "none" }))}
                      />
                    )
                  ) : (
                    <StatusBadge tone="danger" className="justify-self-start">
                      {report.outcome === "LeavesFirst" ? t("end.leavesFirst") : t("end.movesFirst")}
                    </StatusBadge>
                  )}
                </div>
              ))}
            </div>
          </Block>
        ) : null}

        {preview.data?.dottedLinesEnding.length ? (
          <Block title={t("end.endsOn", { date: format.date(lastDay) })}>
            <div className="grid gap-2">
              {preview.data.dottedLinesEnding.map((line) => (
                <Effect key={`${line.person.employeeId}-${line.manager.employeeId}`} icon={<DottedMark />}>
                  {t("end.dottedLine", { person: line.person.displayName, manager: line.manager.displayName })}
                </Effect>
              ))}
            </div>
          </Block>
        ) : null}

        <Block>
          {noteOpen ? (
            <Textarea autoFocus value={note} onChange={(event) => setNote(event.target.value)} aria-label={t("end.note")} rows={3} maxLength={1000} />
          ) : (
            <button type="button" className="justify-self-start type-meta font-semibold text-muted-foreground hover:text-foreground" onClick={() => setNoteOpen(true)}>
              + {t("end.addNote")}
            </button>
          )}
        </Block>

        {error ? <p role="alert" className="pt-2 type-body text-destructive">{error}</p> : null}
      </div>
      <Footer summary={toMove.length
        ? t.rich("summary.reportsMove", { count: toMove.length, date: format.date(boundary), b })
        : t.rich("summary.lastDay", { date: format.date(lastDay), b })}>
        <Button type="button" variant="ghost" onClick={onClose}>{t("action.cancel")}</Button>
        <Button type="button" variant="destructive" disabled={missing || preview.isLoading || endEmployment.isLoading || editChange.isLoading} onClick={() => void save()}>
          {t("action.end", { date: format.date(lastDay) })}
        </Button>
      </Footer>
    </>
  );
}

// --- Start employment (rehire) --------------------------------------------------------------------

function StartForm({ person, editing, onClose }: { person: PeopleProfileDto; editing: WorkforceChangeDto | null; onClose: () => void }) {
  const t = useTranslations("changes");
  const format = useFormat();
  const refusal = useRefusal();
  const key = person.identity.employeeKey;
  const { startEmployment, editChange } = useChangeMutations(key);
  const d = editing?.details;
  const [date, setDate] = useState(editing?.effectiveDate ?? todayIso());
  const [manager, setManager] = useState<ChangePersonRef | null>(d?.managerTo ?? null);
  const [unit, setUnit] = useState<{ id: string; name: string } | null>(
    d?.unitToId ? { id: d.unitToId, name: d.unitTo ?? "" } : person.work?.orgUnitId ? { id: person.work.orgUnitId, name: person.work.organizationName } : null);
  const [jobId, setJobId] = useState<string | null>(d?.jobToId ?? person.work?.jobId ?? null);
  const [placeId, setPlaceId] = useState<string | null>(d ? d.placeToId ?? null : person.work?.placeId ?? null);
  const [error, setError] = useState<string | null>(null);
  const isToday = date === todayIso();

  const save = async () => {
    setError(null);
    const request = { startDate: date, orgUnitId: unit!.id, jobId: jobId!, placeId, managerEmployeeId: manager?.employeeId ?? null };
    try {
      if (editing) await editChange.mutateAsync({ id: editing.id, request: { join: request } });
      else await startEmployment.mutateAsync(request);
      toast.success(t("saved.started", { name: person.identity.displayName, date: format.date(date) }));
      onClose();
    } catch (caught) {
      setError(refusal(caught, t("failed")));
    }
  };

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-[22px] pb-4 pt-1.5">
        <Block title={t("reportsTo")}>
          <PersonPicker date={date} value={manager} onChange={setManager} excludeKey={key} />
        </Block>
        <Block title={t("facts.title")}>
          <div className="grid gap-3">
            <label className="grid gap-1"><span className="type-meta text-muted-foreground">{t("facts.unit")}</span>
              <UnitEditor date={date} value={unit?.id ?? ""} onChange={setUnit} /></label>
            <div className="grid gap-1"><span className="type-meta text-muted-foreground">{t("facts.jobTitle")}</span>
              <JobPicker value={jobId} onChange={(next) => setJobId(next.id)} /></div>
            <div className="grid gap-1"><span className="type-meta text-muted-foreground">{t("facts.location")}</span>
              <PlacePicker value={placeId} onChange={(next) => setPlaceId(next?.id ?? null)} /></div>
          </div>
        </Block>
        <WhenBlock label={t("when.starts")} value={date} onChange={setDate} options={[todayIso()]} />
        <Block>
          <div className="grid grid-cols-[84px_minmax(0,1fr)_auto] items-center gap-2.5">
            <span className="type-meta text-muted-foreground">{t("start.workerId")}</span>
            <span className="type-code text-sm">{person.identity.employeeNumber}</span>
            <span className="type-meta text-muted-foreground">{t("start.kept")}</span>
          </div>
        </Block>
        {error ? <p role="alert" className="pt-2 type-body text-destructive">{error}</p> : null}
      </div>
      <Footer summary={manager
        ? t.rich("summary.joins", { manager: manager.displayName, date: format.date(date), b })
        : t.rich("summary.joinsNoManager", { date: format.date(date), b })}>
        <Button type="button" variant="ghost" onClick={onClose}>{t("action.cancel")}</Button>
        <Button type="button" disabled={!unit || !jobId || startEmployment.isLoading || editChange.isLoading} onClick={() => void save()}>
          {isToday ? t("action.save") : t("action.schedule", { date: format.date(date) })}
        </Button>
      </Footer>
    </>
  );
}

// --- Parts ----------------------------------------------------------------------------------------

const b = (chunks: ReactNode) => <b className="font-semibold text-foreground">{chunks}</b>;

function toRef(option: ManagerOptionDto): ChangePersonRef {
  return { employeeId: option.employeeId, employeeKey: option.employeeKey, displayName: option.displayName };
}

export function Block({ title, aside, children }: { title?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-2.5 border-t py-3.5 first:border-t-0">
      {title ? (
        <div className="flex items-center justify-between gap-2.5">
          <h3 className="type-label font-semibold">{title}</h3>
          {typeof aside === "string" ? <span className="type-meta text-muted-foreground">{aside}</span> : aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Before → after: a grey dot for what is, an amber one for what will be. */
function Rail() {
  return (
    <div aria-hidden className="row-span-2 flex flex-col items-center py-[15px]">
      <i className="size-2 shrink-0 rounded-full bg-muted-foreground/50" />
      <span className="w-[1.5px] flex-1 bg-gradient-to-b from-muted-foreground/50 to-primary" />
      <i className="size-2 shrink-0 rounded-full bg-primary ring-4 ring-primary/15" />
    </div>
  );
}

function Option({ on, onSelect, label, children }: { on: boolean; onSelect: () => void; label: string; children?: ReactNode }) {
  return (
    <div
      role="radio"
      aria-checked={on}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); onSelect(); } }}
      className={cn("grid cursor-pointer grid-cols-[18px_minmax(0,1fr)] items-start gap-2.5 rounded-control border px-3 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on && "border-primary bg-primary-tint")}
    >
      <i className={cn("mt-0.5 size-4 rounded-full border-[1.5px] border-muted-foreground/60", on && "border-[5px] border-primary")} />
      <div className="min-w-0" onClick={on ? (event) => event.stopPropagation() : undefined}>
        <b className="block type-label font-semibold">{label}</b>
        {children}
      </div>
    </div>
  );
}

function Stack({ names }: { names: string[] }) {
  return (
    <span className="flex shrink-0">
      {names.slice(0, 5).map((name, index) => (
        <Monogram key={`${name}-${index}`} name={name} size="sm" className={cn("size-6 text-[9px] ring-2 ring-popover", index > 0 && "-ms-1.5")} />
      ))}
    </span>
  );
}

/** One job fact: as it is, or struck through with the new value in bold; Change opens its editor in place. */
function FactRow({
  label, current, next, open, onOpen, onUndo, onDone, fixed = false, children,
}: {
  label: string;
  current: string;
  next: string | null;
  open: boolean;
  onOpen: () => void;
  onUndo: () => void;
  onDone?: () => void;
  /** Follows from another part (a job's level): shown, not changed here. */
  fixed?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("changes.facts");
  return (
    <div className="grid min-h-[34px] grid-cols-[84px_minmax(0,1fr)_auto] items-center gap-2.5 py-0.5">
      <span className={cn("type-meta text-muted-foreground", next && "text-primary-ink")}>{label}</span>
      {open ? <div className="min-w-0">{children}</div> : (
        <span className="min-w-0 truncate text-[13.5px]">
          {next ? <><s className="me-1.5 text-muted-foreground">{current}</s><span className="font-semibold">{next}</span></> : current}
        </span>
      )}
      {fixed ? <span /> : open && onDone ? (
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>{t("done")}</Button>
      ) : next ? (
        <Button type="button" size="sm" variant="ghost" onClick={onUndo}>{t("undo")}</Button>
      ) : open ? <span /> : (
        <Button type="button" size="sm" variant="ghost" onClick={onOpen}>{t("change")}</Button>
      )}
    </div>
  );
}

export function UnitEditor({ date, value, onChange }: { date: string; value: string; onChange: (unit: { id: string; name: string }) => void }) {
  const hierarchy = useOrganizationHierarchy(date);
  const roots = useMemo(() => hierarchy.data?.roots ?? [], [hierarchy.data]);
  const units = useMemo(() => flattenOrg(roots), [roots]);
  if (hierarchy.isLoading) return <Skeleton className="h-11" />;
  return (
    <OrganizationPicker roots={roots} value={value} invalid={false} onChange={(id) => {
      const unit = units.find((item) => item.id === id);
      if (unit) onChange({ id: unit.id, name: unit.name });
    }} />
  );
}

/** Today, a second common date, or any date from today on (no back-dating here). */
function WhenBlock({ label, value, onChange, options }: { label: string; value: string; onChange: (date: string) => void; options: string[] }) {
  return (
    <Block title={label}>
      <DateChoice label={label} value={value} onChange={onChange} options={options} />
    </Block>
  );
}

function DateChoice({ label, value, onChange, options }: { label: string; value: string; onChange: (date: string) => void; options: string[] }) {
  const t = useTranslations("changes.when");
  const format = useFormat();
  const today = todayIso();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-44">
        <DatePicker value={value} min={today} onChange={(next) => { if (next) onChange(next); }} placeholder={t("otherDate")} />
      </div>
      <QuickPicks
        label={label}
        value={value}
        onPick={onChange}
        options={options.map((option) => ({ value: option, label: option === today ? t("today") : format.date(option) }))}
      />
    </div>
  );
}

function Effect({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[22px_minmax(0,1fr)] gap-2 text-[13px] text-muted-foreground">
      <span className="mt-0.5 text-muted-foreground/80">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

export function DottedMark() {
  return (
    <svg viewBox="0 0 22 22" width="16" height="16" aria-hidden>
      <path d="M11 2v18" stroke="currentColor" strokeWidth="1.8" strokeDasharray="2.5 3" fill="none" />
    </svg>
  );
}

export function Footer({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <footer className="flex items-center gap-2.5 border-t bg-popover px-[22px] py-3.5">
      <p className="min-w-0 flex-1 type-meta text-muted-foreground">{summary}</p>
      {children}
    </footer>
  );
}

/**
 * Picks who someone reports to: a server search of the people they may report to on the date. Shows the chosen
 * person even when the current search doesn't list them.
 */
export function PersonPicker({
  date, value, onChange, forEmployee, excludeKey, compact = false, allowNone = false,
}: {
  date: string;
  value: ChangePersonRef | null;
  onChange: (person: ChangePersonRef | null) => void;
  forEmployee?: string;
  excludeKey?: string;
  compact?: boolean;
  allowNone?: boolean;
}) {
  const t = useTranslations("changes");
  const [search, setSearch] = useState("");
  const options = useManagerOptions(date, search, forEmployee);
  const listed = useMemo(() => {
    const found = (options.data ?? []).filter((option) => option.employeeKey !== excludeKey);
    if (!value || found.some((option) => option.employeeKey === value.employeeKey)) return found;
    return [{ employeeId: value.employeeId || value.employeeKey, employeeKey: value.employeeKey, employeeNumber: "", displayName: value.displayName,
      jobTitle: "", organizationName: "", organizationPath: "", availability: "Available" }, ...found];
  }, [options.data, value, excludeKey]);
  const selectedId = value ? listed.find((option) => option.employeeKey === value.employeeKey)?.employeeId ?? "" : "";
  return (
    <div className={cn("grid min-w-0 gap-1", compact && "[&_button]:min-h-[34px] [&_button]:w-full [&_button]:min-w-0 [&_button]:overflow-hidden [&_button]:py-1 [&_button]:text-[13px]")}>
      <ManagerPicker
        options={listed}
        value={selectedId}
        onChange={(id) => { const option = listed.find((item) => item.employeeId === id); if (option) onChange(toRef(option)); }}
        loading={options.isLoading}
        invalid={false}
        onQueryChange={setSearch}
      />
      {allowNone ? (
        <button type="button" className="justify-self-start type-meta text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100" onClick={() => onChange(null)}>
          {t("chooseNoManager")}
        </button>
      ) : null}
    </div>
  );
}
