"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { QuickPicks } from "@repo/ds/choice";
import { Button, DatePicker, Skeleton, Textarea, cn } from "@repo/ds";
import { StatusBadge } from "@repo/ds/shell";
import { useFormat } from "@repo/ds/lib/use-format";
import type {
  ChangePersonRef,
  ManagerOptionDto,
  PeopleProfileDto,
  WorkforceChangeDto,
} from "@repo/api";
import { MessageSquare, Target, X } from "lucide-react";
import { useRefusal } from "@/i18n/words";
import { JobPicker, PlacePicker } from "@/features/catalog/components/catalog-pickers";
import { useOrganizationHierarchy } from "@/features/organization/api/use-organization";
import { usePeopleProfile } from "../api/use-people";
import { ManagerPicker, OrganizationPicker, flattenOrg } from "../components/workforce-pickers";
import { Monogram } from "../components/workforce-ui";
import {
  useCancelChange,
  useChangeMutations,
  useChangeRights,
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
  const title = kind === "end" ? t("kind.end") : kind === "start" ? t("kind.start") : rights.people ? t("kind.job") : t("kind.manager");

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
        <JobForm person={person} editing={editing ?? null} initialManagerKey={initialManagerKey ?? null} onClose={onClose} onDraft={onDraft} reportingOnly={!rights.people} />
      )}
    </div>
  );
}

// --- Job change -----------------------------------------------------------------------------------

type Fact = "unit" | "title" | "location";
type Picked = { id: string; name: string };

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
  const key = person.identity.employeeKey;
  const employeeId = person.identity.employeeId;
  const { changeJob, editChange } = useChangeMutations(key);
  const cancel = useCancelChange();
  const d = editing?.details;

  const [date, setDate] = useState(editing?.effectiveDate ?? todayIso());
  const [chosen, setChosen] = useState<ChangePersonRef | null>(d?.managerChanged ? d.managerTo : null);
  const [noManager, setNoManager] = useState(Boolean(d?.managerChanged && !d.managerTo));
  const [teamStays, setTeamStays] = useState(d?.teamOutcome === "Stays");
  const [teamManager, setTeamManager] = useState<ChangePersonRef | null>(d?.teamOutcome === "Stays" ? d.teamManager : null);
  const [unit, setUnit] = useState<{ id: string; name: string } | null>(d?.unitChanged && d.unitToId ? { id: d.unitToId, name: d.unitTo ?? "" } : null);
  // An edit starts from the change's picks; undefined is "unchanged", a null place is "no place".
  const [job, setJob] = useState<Picked | null>(d?.titleChanged && d.jobToId ? { id: d.jobToId, name: d.titleTo ?? "" } : null);
  const [place, setPlace] = useState<Picked | null | undefined>(
    d?.locationChanged ? (d.placeToId ? { id: d.placeToId, name: d.locationTo ?? "" } : null) : undefined);
  const [open, setOpen] = useState<Fact | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    onDraft?.({
      managerKey: managerChanged ? (noManager ? null : chosen?.employeeKey ?? null) : current?.employeeKey ?? null,
      teamManagerKey: teamShown && teamStays ? (teamManager?.employeeKey ?? current?.employeeKey ?? null) : null,
    });
  }, [onDraft, managerChanged, noManager, chosen, current, teamShown, teamStays, teamManager]);

  const effects = useLineEffects(employeeId, noManager ? null : chosen?.employeeId ?? null, managerChanged);
  const dottedEnds = chosen && person.dottedLineManagers.some((line) => line.employeeKey === chosen.employeeKey) ? chosen : null;

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
    };
    try {
      const saved = editing
        ? await editChange.mutateAsync({ id: editing.id, request: { job: request } })
        : await changeJob.mutateAsync(request);
      announce(saved);
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

  const summary = teamShown && teamStays
    ? t.rich("summary.withTeam", { name: firstName(person.identity.displayName), count: person.directReportCount, date: format.date(date), b })
    : isToday ? t.rich("summary.today", { b }) : t.rich("summary.scheduled", { date: format.date(date), b });

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-[22px] pb-4 pt-1.5">
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

        {reportingOnly ? null : (
          <Block title={t("facts.title")}>
            <div className="grid">
              <FactRow label={t("facts.unit")} current={work?.organizationName ?? t("facts.none")} next={unitChanged ? unit!.name : null}
                open={open === "unit"} onOpen={() => setOpen("unit")} onUndo={() => { setUnit(null); setOpen(null); }}>
                <UnitEditor date={date} value={unit?.id ?? work?.orgUnitId ?? ""} onChange={(next) => { setUnit(next); setOpen(null); }} />
              </FactRow>
              <FactRow label={t("facts.jobTitle")} current={work?.jobTitle ?? t("facts.none")} next={titleChanged ? job!.name : null}
                open={open === "title"} onOpen={() => setOpen("title")} onUndo={() => { setJob(null); setOpen(null); }} onDone={() => setOpen(null)}>
                <JobPicker value={job?.id ?? work?.jobId ?? null} onChange={(next) => { setJob({ id: next.id, name: next.title }); setOpen(null); }} />
              </FactRow>
              <FactRow label={t("facts.location")} current={work?.location ?? t("facts.none")} next={locationChanged ? (place?.name ?? t("facts.none")) : null}
                open={open === "location"} onOpen={() => setOpen("location")} onUndo={() => { setPlace(undefined); setOpen(null); }} onDone={() => setOpen(null)}>
                <PlacePicker value={place === undefined ? work?.placeId ?? null : place?.id ?? null}
                  onChange={(next) => { setPlace(next ? { id: next.id, name: next.name } : null); setOpen(null); }} />
              </FactRow>
            </div>
          </Block>
        )}

        <WhenBlock label={t("when.from")} value={date} onChange={setDate} options={[todayIso(), firstOfNextMonth()]} />

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

        {error ? <p role="alert" className="pt-2 type-body text-destructive">{error}</p> : null}
      </div>
      <Footer summary={summary}>
        <Button type="button" variant="ghost" onClick={onClose}>{t("action.cancel")}</Button>
        <Button type="button" disabled={!anything || (noManager === false && managerChanged && !chosen) || changeJob.isLoading || editChange.isLoading} onClick={() => void save()}>
          {isToday ? t("action.save") : t("action.schedule", { date: format.date(date) })}
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
  label, current, next, open, onOpen, onUndo, onDone, children,
}: {
  label: string;
  current: string;
  next: string | null;
  open: boolean;
  onOpen: () => void;
  onUndo: () => void;
  onDone?: () => void;
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
      {open && onDone ? (
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
  const t = useTranslations("changes.when");
  const format = useFormat();
  const today = todayIso();
  return (
    <Block title={label}>
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
    </Block>
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
