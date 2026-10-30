"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ApiError, type CompanyListValueDto, type JobDto, type PlaceDto } from "@repo/api";
import { canManageCoreOrganization, useAuth } from "@repo/auth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@repo/ds";
import { EntityPicker, type EntityOption } from "@repo/ds/components/ui/entity-picker";
import { Briefcase, MapPin, Plus } from "lucide-react";
import { useJobMutations, useJobs, usePlaceMutations, usePlaces } from "../api/use-catalog";

/**
 * The pickers every form that sets someone's job uses: a job and a place from the company's catalogue, and a value
 * of one of its lists. Retired entries can't be picked, but the one already held still reads back. Whoever manages
 * the catalogue can add a missing job or place from the picker itself.
 */

const ADD = "__add__";
const NONE = "__none__";

const matches = (text: string, query: string) => text.toLowerCase().includes(query.trim().toLowerCase());

/** "Engineering · Senior": what tells two jobs with near titles apart. */
export function jobContext(job: Pick<JobDto, "family" | "level">): string | undefined {
  return [job.family?.label, job.level?.label].filter(Boolean).join(" · ") || undefined;
}

export function placeContext(place: Pick<PlaceDto, "city" | "country">): string | undefined {
  return [place.city, place.country].filter(Boolean).join(", ") || undefined;
}

function useAddFailed() {
  const t = useTranslations("catalog.pickers");
  return (error: unknown) =>
    toast.error(error instanceof ApiError && error.status === 409 ? t("addExists") : t("addFailed"));
}

export function JobPicker({
  value,
  onChange,
  invalid = false,
  disabled = false,
  id,
}: {
  value: string | null;
  onChange: (job: JobDto) => void;
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
}) {
  const t = useTranslations("catalog.pickers");
  const { user } = useAuth();
  const canAdd = canManageCoreOrganization(user);
  const jobs = useJobs();
  const { create } = useJobMutations();
  const failed = useAddFailed();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const all = useMemo(() => jobs.data ?? [], [jobs.data]);
  const selected = all.find((job) => job.id === value) ?? null;

  const options = useMemo<EntityOption[]>(() => {
    const found = all
      .filter((job) => !job.isRetired && (!search.trim() || matches(`${job.title} ${jobContext(job) ?? ""}`, search)))
      .slice(0, 50)
      .map((job) => ({ id: job.id, title: job.title, description: jobContext(job) }));
    const exact = all.some((job) => job.title.toLowerCase() === search.trim().toLowerCase());
    return canAdd && search.trim() && !exact
      ? [...found, { id: ADD, title: t("addJob", { title: search.trim() }), media: <Plus className="size-4 text-muted-foreground" aria-hidden /> }]
      : found;
  }, [all, search, canAdd, t]);

  async function select(optionId: string) {
    if (optionId !== ADD) {
      const job = all.find((item) => item.id === optionId);
      if (job) onChange(job);
      setOpen(false);
      return;
    }
    try {
      const job = await create.mutateAsync({ title: search.trim() });
      onChange(job);
      setSearch("");
      setOpen(false);
    } catch (error) {
      failed(error);
    }
  }

  return (
    <div id={id} aria-invalid={invalid || undefined} className="rounded-control aria-invalid:ring-2 aria-invalid:ring-destructive/40">
      <EntityPicker
        selection={selected ? { title: selected.isRetired ? t("retiredName", { name: selected.title }) : selected.title, media: <Briefcase className="size-4 text-muted-foreground" aria-hidden /> } : null}
        selectedId={value}
        options={options}
        open={open}
        onOpenChange={setOpen}
        search={search}
        onSearchChange={setSearch}
        onSelect={(optionId) => void select(optionId)}
        loading={jobs.isLoading || create.isLoading}
        disabled={disabled}
        placeholder={t("pickJob")}
        placeholderIcon={<Briefcase className="size-4" aria-hidden />}
        searchPlaceholder={t("searchJobs")}
        emptyLabel={jobs.error ? t("jobsDidNotLoad") : canAdd ? t("noJobMatchAdd") : t("noJobMatch")}
        hint={all.length === 0 ? (canAdd ? t("noJobsYetAdd") : t("noJobsYet")) : undefined}
        triggerClassName="min-h-10"
      />
    </div>
  );
}

/** A place, or none (places are optional on a job). */
export function PlacePicker({
  value,
  onChange,
  disabled = false,
  id,
}: {
  value: string | null;
  onChange: (place: PlaceDto | null) => void;
  disabled?: boolean;
  id?: string;
}) {
  const t = useTranslations("catalog.pickers");
  const { user } = useAuth();
  const canAdd = canManageCoreOrganization(user);
  const places = usePlaces();
  const { create } = usePlaceMutations();
  const failed = useAddFailed();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const all = useMemo(() => places.data ?? [], [places.data]);
  const selected = all.find((place) => place.id === value) ?? null;

  const options = useMemo<EntityOption[]>(() => {
    const found = all
      .filter((place) => !place.isRetired && (!search.trim() || matches(`${place.name} ${placeContext(place) ?? ""}`, search)))
      .slice(0, 50)
      .map((place) => ({ id: place.id, title: place.name, description: placeContext(place) }));
    const exact = all.some((place) => place.name.toLowerCase() === search.trim().toLowerCase());
    const none = value && !search.trim() ? [{ id: NONE, title: t("noPlace") }] : [];
    const add = canAdd && search.trim() && !exact
      ? [{ id: ADD, title: t("addPlace", { name: search.trim() }), media: <Plus className="size-4 text-muted-foreground" aria-hidden /> }]
      : [];
    return [...none, ...found, ...add];
  }, [all, search, canAdd, value, t]);

  async function select(optionId: string) {
    if (optionId === NONE) onChange(null);
    else if (optionId !== ADD) {
      const place = all.find((item) => item.id === optionId);
      if (place) onChange(place);
    } else {
      try {
        onChange(await create.mutateAsync({ name: search.trim() }));
        setSearch("");
      } catch (error) {
        failed(error);
        return;
      }
    }
    setOpen(false);
  }

  return (
    <div id={id}>
      <EntityPicker
        selection={selected ? { title: selected.isRetired ? t("retiredName", { name: selected.name }) : selected.name, media: <MapPin className="size-4 text-muted-foreground" aria-hidden /> } : null}
        selectedId={value}
        options={options}
        open={open}
        onOpenChange={setOpen}
        search={search}
        onSearchChange={setSearch}
        onSelect={(optionId) => void select(optionId)}
        loading={places.isLoading || create.isLoading}
        disabled={disabled}
        placeholder={t("pickPlace")}
        placeholderIcon={<MapPin className="size-4" aria-hidden />}
        searchPlaceholder={t("searchPlaces")}
        emptyLabel={places.error ? t("placesDidNotLoad") : canAdd ? t("noPlaceMatchAdd") : t("noPlaceMatch")}
        hint={all.length === 0 ? (canAdd ? t("noPlacesYetAdd") : t("noPlacesYet")) : undefined}
        triggerClassName="min-h-10"
      />
    </div>
  );
}

/** One value of a company list, or none. Retired values are offered only when already chosen. */
export function ListValueSelect({
  values,
  value,
  onChange,
  placeholder,
  id,
  ariaLabel,
}: {
  values: CompanyListValueDto[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder: string;
  id?: string;
  ariaLabel?: string;
}) {
  const t = useTranslations("catalog.pickers");
  const offered = values.filter((item) => !item.isRetired || item.id === value);
  return (
    <Select value={value ?? NONE} onValueChange={(next) => onChange(next === NONE ? null : next)}>
      <SelectTrigger id={id} aria-label={ariaLabel} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t("notSet")}</SelectItem>
        {offered.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            {item.isRetired ? t("retiredName", { name: item.label }) : item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
