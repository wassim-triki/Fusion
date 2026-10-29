"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Briefcase, X } from "lucide-react";
import type { ChangePersonRef, OpenRoleStatus, OrgChartOpenRoleDto } from "@repo/api";
import { Segmented } from "@repo/ds/choice";
import { Button, DatePicker, Input } from "@repo/ds";
import { useRefusal } from "@/i18n/words";
import { Block, Footer, PersonPicker, UnitEditor } from "@/features/people/changes/change-panel";
import { useOpenRoleMutations } from "../api/use-org-chart";

/** What the chart previews while the panel is open: the dashed card in the chosen manager's line. */
export interface OpenRoleDraft {
  managerKey: string;
  jobTitle: string;
  unitName: string | null;
  targetStartDate: string | null;
  status: OpenRoleStatus;
}

const STATUSES: OpenRoleStatus[] = ["Open", "OnHold", "Filled", "Closed"];
const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const firstName = (name: string) => name.split(" ")[0] ?? name;
const b = (chunks: ReactNode) => <b className="font-semibold text-foreground">{chunks}</b>;

/**
 * Adds an open role under a manager, or edits one, in the chart's panel slot. The chart shows the dashed card
 * where it will sit while the panel is open.
 */
export function OpenRolePanel({
  editing, manager, unit: managerUnit, onDraft, onClose,
}: {
  /** The role being edited; null adds a new one. */
  editing: OrgChartOpenRoleDto | null;
  /** The manager the role reports to (the selected person, or the role's manager). */
  manager: ChangePersonRef;
  /** The manager's unit, the default for a new role. */
  unit: { id: string; name: string } | null;
  onDraft: (draft: OpenRoleDraft | null) => void;
  onClose: () => void;
}) {
  const t = useTranslations("orgChart.role");
  const refusal = useRefusal();
  const { create, update } = useOpenRoleMutations();
  const today = iso(new Date());

  const [jobTitle, setJobTitle] = useState(editing?.jobTitle ?? "");
  const [reportsTo, setReportsTo] = useState<ChangePersonRef | null>(manager);
  const [unit, setUnit] = useState<{ id: string; name: string } | null>(
    editing?.unit ? { id: editing.unit.id, name: editing.unit.name } : managerUnit);
  const [start, setStart] = useState<string>(editing?.targetStartDate ?? "");
  const [status, setStatus] = useState<OpenRoleStatus>(editing?.status ?? "Open");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onDraft(reportsTo ? { managerKey: reportsTo.employeeKey, jobTitle: jobTitle.trim(), unitName: unit?.name ?? null, targetStartDate: start || null, status } : null);
  }, [onDraft, reportsTo, jobTitle, unit, start, status]);
  useEffect(() => () => onDraft(null), [onDraft]);

  const saving = create.isLoading || update.isLoading;
  const ready = Boolean(reportsTo && unit && jobTitle.trim()) && !saving;
  const save = async () => {
    if (!reportsTo || !unit) return;
    setError(null);
    const request = { jobTitle: jobTitle.trim(), managerKey: reportsTo.employeeKey, orgUnitId: unit.id, targetStartDate: start || null, status };
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, request });
        toast.success(status === "Filled" ? t("saved.filled", { title: request.jobTitle })
          : status === "Closed" ? t("saved.closed", { title: request.jobTitle })
          : t("saved.updated"));
      } else {
        await create.mutateAsync(request);
        toast.success(t("saved.added", { title: request.jobTitle, name: firstName(reportsTo.displayName) }));
      }
      onClose();
    } catch (caught) {
      setError(refusal(caught, t("failed")));
    }
  };

  const name = reportsTo ? firstName(reportsTo.displayName) : "";
  const summary = status === "Filled" || status === "Closed" ? t("summary.leaves")
    : status === "OnHold" ? t.rich("summary.onHold", { name, b })
    : t.rich("summary.open", { name, b });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-start gap-3.5 border-b px-[22px] pb-4 pt-5">
        <span className="grid size-11 shrink-0 place-items-center rounded-control bg-primary-tint text-primary"><Briefcase className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="type-meta text-muted-foreground">{editing ? t("kind") : t("new")}</p>
          <h2 className="truncate text-lg font-semibold leading-snug">{jobTitle.trim() || (editing ? editing.jobTitle : t("untitled"))}</h2>
          {reportsTo ? <p className="truncate type-meta text-muted-foreground">{t("inTeam", { name: reportsTo.displayName })}</p> : null}
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("close")} onClick={onClose}><X className="size-4" /></Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-[22px] pb-4 pt-1.5">
        <Block title={t("jobTitle")}>
          <Input value={jobTitle} maxLength={200} autoFocus={!editing} aria-label={t("jobTitle")} onChange={(event) => setJobTitle(event.target.value)} />
        </Block>
        <Block title={t("reportsTo")}>
          <PersonPicker date={today} value={reportsTo} onChange={setReportsTo} />
        </Block>
        <Block title={t("unit")}>
          <UnitEditor date={today} value={unit?.id ?? ""} onChange={setUnit} />
        </Block>
        <Block title={t("targetStart")} aside={start ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => setStart("")}>{t("clear")}</Button>
        ) : t("optional")}>
          <DatePicker value={start} min={editing?.targetStartDate && editing.targetStartDate < today ? editing.targetStartDate : today}
            onChange={(next) => setStart(next ?? "")} placeholder={t("pickDate")} />
        </Block>
        <Block title={t("statusLabel")}>
          <Segmented
            label={t("statusLabel")}
            value={status}
            onChange={setStatus}
            options={(editing ? STATUSES : STATUSES.slice(0, 2)).map((option) => ({ value: option, label: t(`status.${option}`) }))}
          />
        </Block>
        {error ? <p role="alert" className="pt-2 type-body text-destructive">{error}</p> : null}
      </div>
      <Footer summary={summary}>
        <Button type="button" variant="ghost" onClick={onClose}>{t("cancel")}</Button>
        <Button type="button" disabled={!ready} onClick={() => void save()}>
          {editing ? t("saveEdit") : t("save")}
        </Button>
      </Footer>
    </div>
  );
}
