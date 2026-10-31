"use client";

import { reportPerformanceFailure } from "@/features/performance/api/performance-failure";

import { useEffect, useMemo, useState } from "react";
import { Check, Plus, Search, TriangleAlert, UserPlus, X } from "@/lib/icons";
import type { WorkforceEmployeeSummaryDto } from "@repo/api";
import { useEmployeePicker } from "@repo/workforce-ui";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@repo/ds/components/ui/sheet";
import { Input } from "@repo/ds/components/ui/input";
import { Button } from "@repo/ds/components/ui/button";
import { AsyncButton } from "@repo/ds/shell";
import { Avatar, AvatarFallback } from "@repo/ds/components/ui/avatar";
import { Skeleton } from "@repo/ds/components/ui/skeleton";
import { cn } from "@repo/ds/lib/utils";
import { initials } from "./population-model";
import { useTranslations } from "next-intl";

/**
 * The exception picker: layer specific people onto the base scope. It searches the tenant workforce,
 * makes it obvious who the scope already covers (so HR doesn't double-add), lets several people be
 * gathered into a tray, and commits them as explicit inclusions in one write. An inclusion never
 * overrides eligibility — a person with a hard issue can still be added, and simply surfaces under
 * Needs attention afterwards; the picker previews that up front rather than hiding it.
 */
export function AddInclusionSheet({
  open,
  onOpenChange,
  inclusionIds,
  scopeMembers,
  onAddMany,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Already added individually. */
  inclusionIds: Set<string>;
  /** Already covered by the scope → unit name (or null) the person came in through. */
  scopeMembers: Map<string, string | null>;
  onAddMany: (employeeIds: string[]) => Promise<void>;
}) {
  const t = useTranslations("cycleSetup.AddInclusionSheet");
  const [term, setTerm] = useState("");
  const [tray, setTray] = useState<WorkforceEmployeeSummaryDto[]>([]);
  const [committing, setCommitting] = useState(false);
  const picker = useEmployeePicker(term, open);
  const items = picker.data?.items ?? [];

  // Reset the working state whenever the sheet is closed so it opens fresh each time.
  useEffect(() => {
    if (!open) {
      setTerm("");
      setTray([]);
    }
  }, [open]);

  const trayIds = useMemo(
    () => new Set(tray.map((person) => person.employeeId)),
    [tray]
  );

  function toggle(person: WorkforceEmployeeSummaryDto) {
    setTray((prev) =>
      prev.some((current) => current.employeeId === person.employeeId)
        ? prev.filter((current) => current.employeeId !== person.employeeId)
        : [...prev, person]
    );
  }

  function remove(employeeId: string) {
    setTray((prev) =>
      prev.filter((current) => current.employeeId !== employeeId)
    );
  }

  async function commit() {
    if (tray.length === 0) return;
    setCommitting(true);
    try {
      await onAddMany(tray.map((person) => person.employeeId));
      onOpenChange(false);
    } catch (error) {
      reportPerformanceFailure(error, t("couldNotAddTheEmployees"));
    } finally {
      setCommitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        <SheetHeader className="border-b border-border px-6 py-5">
          <SheetTitle>{t("addSpecificEmployees")}</SheetTitle>
          <SheetDescription>
            {t("addEmployeesOutsideTheSelected")}
          </SheetDescription>
        </SheetHeader>

        <div className="border-b border-border px-6 py-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute inset-s-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder={t("searchByNameEmailOr")}
              className="ps-9"
              autoFocus
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {picker.isLoading ? (
            <div className="space-y-2 px-3 py-1">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-14 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
              <UserPlus className="size-6 text-muted-foreground" aria-hidden />
              <p className="type-body-secondary text-muted-foreground">
                {term.trim().length >= 2
                  ? t("noOneMatchesThatSearch")
                  : t("searchForPeopleToAdd")}
              </p>
            </div>
          ) : (
            <ul className="space-y-0.5">
              {items.map((person) => (
                <ResultRow
                  key={person.employeeId}
                  person={person}
                  selected={trayIds.has(person.employeeId)}
                  alreadyIncluded={inclusionIds.has(person.employeeId)}
                  scopeUnit={
                    scopeMembers.has(person.employeeId)
                      ? { name: scopeMembers.get(person.employeeId) ?? null }
                      : null
                  }
                  onToggle={() => toggle(person)}
                />
              ))}
            </ul>
          )}
        </div>

        {tray.length > 0 ? (
          <div className="border-t border-border px-6 py-3">
            <div className="flex items-center justify-between">
              <p className="type-label text-foreground">{t("selectedEmployees")}</p>
              <span className="flex size-5 items-center justify-center rounded-full bg-primary-tint type-meta-strong tabular-nums text-primary-ink">
                {tray.length}
              </span>
            </div>
            <ul className="mt-2 flex max-h-28 flex-wrap gap-2 overflow-y-auto">
              {tray.map((person) => (
                <li
                  key={person.employeeId}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-muted py-1 ps-3 pe-1.5"
                >
                  <span className="type-meta text-foreground">
                    {person.displayName}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(person.employeeId)}
                    className="flex size-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={t("remove", { displayName: person.displayName })}
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-4 border-t border-border px-6 py-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <AsyncButton
            pending={committing}
            disabled={tray.length === 0}
            onClick={commit}
          >
            {tray.length === 0
              ? t("addEmployees")
              : (tray.length === 1 ? t("addEmployee", { length: tray.length }) : t("addEmployees2", { length: tray.length }))}
          </AsyncButton>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Whether the person's current Core data would resolve a valid reviewer, for an at-a-glance preview. */
function issuePreview(person: WorkforceEmployeeSummaryDto): "noPrimaryAssignment" | "noEligibleReviewer" | null {
  if (!person.orgUnit) return "noPrimaryAssignment";
  const manager = person.manager;
  const selfManaged = manager?.employeeId === person.employeeId;
  if (!manager || !manager.isActive || selfManaged)
    return "noEligibleReviewer";
  return null;
}

function ResultRow({
  person,
  selected,
  alreadyIncluded,
  scopeUnit,
  onToggle,
}: {
  person: WorkforceEmployeeSummaryDto;
  selected: boolean;
  alreadyIncluded: boolean;
  scopeUnit: { name: string | null } | null;
  onToggle: () => void;
}) {
  const t = useTranslations("cycleSetup.ResultRow");
  const disabled = alreadyIncluded || scopeUnit !== null;
  const issue = issuePreview(person);

  const meta = [person.jobTitle ?? "—", person.orgUnit?.name]
    .filter(Boolean)
    .join(" · ");

  const body = (
    <>
      <Avatar className="size-9 shrink-0">
        <AvatarFallback hue={person.displayName} className="type-meta">
          {initials(person.displayName)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="type-label truncate text-foreground">
          {person.displayName}
        </p>
        <p className="type-meta truncate text-muted-foreground">{meta}</p>
        {disabled ? (
          <p className="type-meta text-muted-foreground">
            {alreadyIncluded
              ? t("alreadyAddedIndividually")
              : t("alreadyIncludedThrough", { value: scopeUnit?.name ?? "the selected scope" })}
          </p>
        ) : issue ? (
          <p className="mt-0.5 flex items-center gap-1 type-meta text-muted-foreground">
            <TriangleAlert className="size-3" aria-hidden />
            {t("mayNeedAttentionAfterAdding", { issue: t(issue) })}
          </p>
        ) : person.manager ? (
          <p className="type-meta text-muted-foreground">
            {t("reviewer", { displayName: person.manager.displayName })}
          </p>
        ) : null}
      </div>
    </>
  );

  if (disabled) {
    return (
      <li className="flex items-center gap-3 rounded-control px-3 py-2 opacity-60">
        {body}
        <Check className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        // eslint-disable-next-line no-restricted-syntax -- a row in a searchable people list toggles its own selection; a list, not a few options
        aria-pressed={selected}
        className={cn(
          "flex w-full items-center gap-3 rounded-control px-3 py-2 text-start transition-colors",
          selected
            ? "bg-primary/[0.06] ring-1 ring-primary/30"
            : "hover:bg-muted/50"
        )}
      >
        {body}
        {selected ? (
          <span className="flex shrink-0 items-center gap-1 rounded-control bg-primary px-2 py-1 type-meta-strong text-primary-foreground">
            <Check className="size-3.5" aria-hidden />
            {t("selected")}
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1 rounded-control border border-border px-2 py-1 type-meta-strong text-foreground">
            <Plus className="size-3.5" aria-hidden />
            {t("add")}
          </span>
        )}
      </button>
    </li>
  );
}
