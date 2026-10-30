"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ApiError, type JobDto, type PlaceDto } from "@repo/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
} from "@repo/ds";
import { EntityPicker } from "@repo/ds/components/ui/entity-picker";
import { useCompanyLists, useJobMutations, usePlaceMutations } from "../api/use-catalog";
import { jobContext, ListValueSelect, placeContext } from "./catalog-pickers";

/** A failed catalogue save in words: a duplicate name says so; anything else asks to try again. */
function useSaveError() {
  const t = useTranslations("catalog");
  return (error: unknown, kind: "job" | "place") =>
    error instanceof ApiError && error.status === 409 ? t(`${kind}.exists`) : t("saveFailed");
}

export function JobDialog({ job, open, onOpenChange }: { job: JobDto | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("catalog");
  const lists = useCompanyLists(open);
  const { create, update } = useJobMutations();
  const describe = useSaveError();
  const [title, setTitle] = useState("");
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [levelId, setLevelId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(job?.title ?? "");
    setFamilyId(job?.family?.id ?? null);
    setLevelId(job?.level?.id ?? null);
    setError(null);
  }, [open, job]);

  const families = lists.data?.find((list) => list.id === "job-families")?.values ?? [];
  const levels = lists.data?.find((list) => list.id === "levels")?.values ?? [];
  const saving = create.isLoading || update.isLoading;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const request = { title: title.trim(), familyId, levelId };
    try {
      if (job) await update.mutateAsync({ id: job.id, request });
      else await create.mutateAsync(request);
      toast.success(job ? t("job.saved", { title: request.title }) : t("job.added", { title: request.title }));
      onOpenChange(false);
    } catch (failure) {
      setError(describe(failure, "job"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{job ? t("job.editTitle") : t("job.addTitle")}</DialogTitle>
          {job && job.peopleCount > 0 ? <DialogDescription>{t("job.renameReach", { count: job.peopleCount })}</DialogDescription> : null}
        </DialogHeader>
        <form id="job-form" onSubmit={(event) => void submit(event)}>
          <FieldGroup>
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="job-title">{t("job.title")}</FieldLabel>
              <Input id="job-title" autoFocus required maxLength={150} value={title} onChange={(event) => setTitle(event.target.value)} />
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="job-family">{t("job.family")}</FieldLabel>
                <ListValueSelect id="job-family" values={families} value={familyId} onChange={setFamilyId} placeholder={t("notSet")} />
              </Field>
              <Field>
                <FieldLabel htmlFor="job-level">{t("job.level")}</FieldLabel>
                <ListValueSelect id="job-level" values={levels} value={levelId} onChange={setLevelId} placeholder={t("notSet")} />
              </Field>
            </div>
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
          <Button form="job-form" type="submit" disabled={!title.trim() || saving}>
            {job ? t("saveChanges") : t("job.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PlaceDialog({ place, open, onOpenChange }: { place: PlaceDto | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("catalog");
  const { create, update } = usePlaceMutations();
  const describe = useSaveError();
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(place?.name ?? "");
    setCity(place?.city ?? "");
    setCountry(place?.country ?? "");
    setError(null);
  }, [open, place]);

  const saving = create.isLoading || update.isLoading;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const request = { name: name.trim(), city: city.trim() || null, country: country.trim() || null };
    try {
      if (place) await update.mutateAsync({ id: place.id, request });
      else await create.mutateAsync(request);
      toast.success(place ? t("place.saved", { name: request.name }) : t("place.added", { name: request.name }));
      onOpenChange(false);
    } catch (failure) {
      setError(describe(failure, "place"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{place ? t("place.editTitle") : t("place.addTitle")}</DialogTitle>
        </DialogHeader>
        <form id="place-form" onSubmit={(event) => void submit(event)}>
          <FieldGroup>
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="place-name">{t("place.name")}</FieldLabel>
              <Input id="place-name" autoFocus required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="place-city">{t("place.city")}</FieldLabel>
                <Input id="place-city" maxLength={100} value={city} onChange={(event) => setCity(event.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="place-country">{t("place.country")}</FieldLabel>
                <Input id="place-country" maxLength={100} value={country} onChange={(event) => setCountry(event.target.value)} />
              </Field>
            </div>
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
          <Button form="place-form" type="submit" disabled={!name.trim() || saving}>
            {place ? t("saveChanges") : t("place.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Mergeable = { id: string; name: string; context?: string; peopleCount: number; openRoleCount: number };

/**
 * Merges one job (or place) into another: everyone and every open role on it moves, and it goes. A catalogue
 * correction for duplicates, so the people's history isn't touched.
 */
export function MergeDialog({
  kind,
  source,
  candidates,
  onOpenChange,
}: {
  kind: "job" | "place";
  source: Mergeable | null;
  candidates: Mergeable[];
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("catalog");
  const jobs = useJobMutations();
  const places = usePlaceMutations();
  const merge = kind === "job" ? jobs.merge : places.merge;
  const [intoId, setIntoId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  useEffect(() => {
    setIntoId(null);
    setSearch("");
  }, [source]);

  const into = candidates.find((item) => item.id === intoId) ?? null;
  const options = candidates
    .filter((item) => item.id !== source?.id && (!search.trim() || `${item.name} ${item.context ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())))
    .slice(0, 50)
    .map((item) => ({ id: item.id, title: item.name, description: item.context }));

  async function confirm() {
    if (!source || !into) return;
    try {
      await merge.mutateAsync({ id: source.id, intoId: into.id });
      toast.success(t(`${kind}.merged`, { from: source.name, into: into.name }));
      onOpenChange(false);
    } catch {
      toast.error(t("saveFailed"));
    }
  }

  return (
    <Dialog open={source !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t(`${kind}.mergeTitle`, { name: source?.name ?? "" })}</DialogTitle>
          <DialogDescription>
            {t(`${kind}.mergeReach`, { people: source?.peopleCount ?? 0, roles: source?.openRoleCount ?? 0, name: source?.name ?? "" })}
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel>{t(`${kind}.mergeInto`)}</FieldLabel>
          <EntityPicker
            selection={into ? { title: into.name } : null}
            selectedId={intoId}
            options={options}
            open={open}
            onOpenChange={setOpen}
            search={search}
            onSearchChange={setSearch}
            onSelect={(id) => {
              setIntoId(id);
              setOpen(false);
            }}
            placeholder={t(`${kind}.mergePick`)}
            searchPlaceholder={t(`${kind}.search`)}
            emptyLabel={t("noMatch")}
            triggerClassName="min-h-10"
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
          <Button onClick={() => void confirm()} disabled={!into || merge.isLoading}>
            {t(`${kind}.mergeAction`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Deleting is only offered for an entry nothing ever used, so it needs no more than naming what goes. */
export function DeleteDialog({
  kind,
  target,
  onOpenChange,
}: {
  kind: "job" | "place";
  target: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("catalog");
  const jobs = useJobMutations();
  const places = usePlaceMutations();
  const remove = kind === "job" ? jobs.remove : places.remove;
  async function confirm() {
    if (!target) return;
    try {
      await remove.mutateAsync(target.id);
      toast.success(t(`${kind}.deleted`, { name: target.name }));
    } catch {
      toast.error(t("saveFailed"));
    }
    onOpenChange(false);
  }
  return (
    <AlertDialog open={target !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(`${kind}.deleteTitle`, { name: target?.name ?? "" })}</AlertDialogTitle>
          <AlertDialogDescription>{t(`${kind}.deleteReach`)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void confirm()}>
            {t(`${kind}.delete`)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export const toMergeable = {
  job: (job: JobDto): Mergeable => ({ id: job.id, name: job.title, context: jobContext(job), peopleCount: job.peopleCount, openRoleCount: job.openRoleCount }),
  place: (place: PlaceDto): Mergeable => ({ id: place.id, name: place.name, context: placeContext(place), peopleCount: place.peopleCount, openRoleCount: place.openRoleCount }),
};
