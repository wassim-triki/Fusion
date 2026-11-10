"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Button,
  Calendar,
  DatePicker,
  Field,
  FieldError,
  FieldLabel,
  Input,
  PersonAvatar,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  cn,
} from "@repo/ds";
import { QuickPicks, Segmented } from "@repo/ds/choice";
import { AsyncButton, PageContainer } from "@repo/ds/shell";
import {
  ApiError,
  type EstablishmentReviewDto,
  type HireInvite,
  type HiringContextDto,
  type ManagerOptionDto,
  type OrganizationHierarchyNodeDto,
} from "@repo/api";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  Briefcase,
  CalendarDays,
  Check,
  ChevronDown,
  CircleUserRound,
  Mail,
  MapPin,
  Network,
  Search,
  UserPlus,
  X,
} from "lucide-react";
import { useCompanyLists, useJobs, usePlaces } from "@/features/catalog/api/use-catalog";
import { useOrganizationHierarchy } from "@/features/organization/api/use-organization";
import { OrganizationTree } from "@/features/organization/components/organization-tree";
import { useHiringContext, usePeopleEstablishmentMutations } from "../api/use-people";
import { useManagerOptions } from "../changes/use-changes";
import { isEmailAddress } from "@repo/ds/lib/email";

const todayIso = () => new Date().toISOString().slice(0, 10);

type Form = {
  firstName: string;
  lastName: string;
  preferredName: string;
  workEmail: string;
  phone: string;
  numberMode: "Generated" | "Manual";
  employeeNumber: string;
  firstDay: string;
  employmentTypeId: string;
  orgUnitId: string;
  jobId: string;
  jobTitle: string;
  placeId: string;
  placeName: string;
  managerId: string;
  openRoleId: string;
  invite: HireInvite | "";
  fields: Record<string, string | string[]>;
};

type Errors = Record<string, string | undefined>;

const BLANK: Form = {
  firstName: "", lastName: "", preferredName: "", workEmail: "", phone: "",
  numberMode: "Generated", employeeNumber: "", firstDay: "", employmentTypeId: "",
  orgUnitId: "", jobId: "", jobTitle: "", placeId: "", placeName: "", managerId: "", openRoleId: "",
  invite: "", fields: {},
};

function flatten(nodes: OrganizationHierarchyNodeDto[]): { id: string; name: string }[] {
  return nodes.flatMap((node) => [{ id: node.unit.id, name: node.unit.name }, ...flatten(node.children)]);
}

const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const addDays = (iso: string, days: number) => {
  const date = asDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const daysBetween = (from: string, to: string) => Math.round((asDate(to).getTime() - asDate(from).getTime()) / 864e5);

function useDates() {
  const locale = useLocale();
  return useMemo(() => {
    const format = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...options });
    const short = format({ weekday: "short", day: "numeric", month: "short" });
    const long = format({ weekday: "short", day: "numeric", month: "short", year: "numeric" });
    const full = format({ day: "numeric", month: "short", year: "numeric" });
    const weekday = format({ weekday: "short" });
    const monthYear = format({ month: "short", year: "numeric" });
    const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    return {
      short: (iso: string) => short.format(asDate(iso)),
      long: (iso: string) => long.format(asDate(iso)),
      full: (iso: string) => full.format(asDate(iso)),
      weekday: (iso: string) => weekday.format(asDate(iso)),
      monthYear: (iso: string) => monthYear.format(asDate(iso)),
      relative: (iso: string) => {
        const days = daysBetween(todayIso(), iso);
        return Math.abs(days) < 14 ? relative.format(days, "day") : relative.format(Math.round(days / 7), "week");
      },
    };
  }, [locale]);
}

/** The ghost trigger of the band: no box at rest, a quiet fill on hover, red text when the field is wrong. */
const ghost = "rounded-control text-start outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring";

function Well({ children, dashed = false }: { children: ReactNode; dashed?: boolean }) {
  return (
    <span
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground [&_svg]:size-4",
        dashed ? "border-[1.5px] border-dashed border-muted-foreground/50" : "bg-inlay",
      )}
    >
      {children}
    </span>
  );
}

function SearchBox({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return (
    <div className="relative border-b border-border p-2">
      <Search className="pointer-events-none absolute inset-s-4.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input autoFocus value={value} onChange={(event) => onChange(event.target.value)} placeholder={label} aria-label={label} className="ps-8" />
    </div>
  );
}

function MenuRow({ on, onPick, children }: { on: boolean; onPick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        "flex w-full min-w-0 items-center gap-2.5 rounded-inset px-2.5 py-2 text-start outline-none hover:bg-secondary focus-visible:bg-secondary",
        on && "bg-primary-tint",
      )}
    >
      {children}
    </button>
  );
}

/** A list of names to pick one from, searched in place. */
function ListMenu<T extends { id: string; name: string }>({
  items, value, onPick, search, empty,
}: { items: T[]; value: string; onPick: (item: T) => void; search: string; empty: string }) {
  const [query, setQuery] = useState("");
  const shown = items.filter((item) => !query.trim() || item.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 60);
  return (
    <>
      <SearchBox value={query} onChange={setQuery} label={search} />
      <div className="max-h-72 overflow-y-auto p-1.5">
        {shown.map((item) => (
          <MenuRow key={item.id} on={item.id === value} onPick={() => onPick(item)}>
            <span className="min-w-0 flex-1 truncate type-body">{item.name}</span>
            {item.id === value ? <Check className="size-4 shrink-0" aria-hidden /> : null}
          </MenuRow>
        ))}
        {shown.length === 0 ? <p className="p-4 text-center type-meta text-muted-foreground">{empty}</p> : null}
      </div>
    </>
  );
}

/** A field the company asks of everyone: tags take several values, the rest one. */
function CompanyField({
  field, value, onChange, error,
}: {
  field: HiringContextDto["requiredFields"][number];
  value: string | string[] | undefined;
  onChange: (value: string | string[]) => void;
  error?: string;
}) {
  const t = useTranslations("people.add");
  const [draft, setDraft] = useState("");
  const id = `field-${field.key}`;
  if (field.type === "Tags") {
    const tags = Array.isArray(value) ? value : [];
    const add = () => {
      const next = draft.trim();
      if (next && !tags.some((tag) => tag.toLowerCase() === next.toLowerCase())) onChange([...tags, next]);
      setDraft("");
    };
    return (
      <Field data-invalid={Boolean(error)}>
        <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
        <div
          aria-invalid={Boolean(error) || undefined}
          className="flex flex-wrap items-center gap-1.5 rounded-control border border-input bg-field p-1.5 aria-invalid:border-destructive"
        >
          {tags.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-inlay py-0.5 ps-2.5 pe-1 type-label">
              {tag}
              <button type="button" aria-label={t("remove", { value: tag })} onClick={() => onChange(tags.filter((item) => item !== tag))}
                className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground">
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
          <input
            id={id}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                add();
              }
            }}
            onBlur={add}
            placeholder={tags.length ? undefined : t("addValue")}
            className="h-7 min-w-24 flex-1 bg-transparent px-1.5 type-body outline-none placeholder:text-muted-foreground"
          />
        </div>
        <FieldError>{error}</FieldError>
      </Field>
    );
  }
  const text = typeof value === "string" ? value : "";
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
      {field.type === "Date" ? (
        <DatePicker id={id} value={text} onChange={onChange} aria-invalid={Boolean(error)} />
      ) : (
        <Input id={id} value={text} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)}
          type={field.type === "Email" ? "email" : field.type === "Phone" ? "tel" : "text"} />
      )}
      <FieldError>{error}</FieldError>
    </Field>
  );
}

function failure(error: unknown): { field: string | null; message: string | null; offline: boolean } {
  if (!(error instanceof ApiError)) return { field: null, message: null, offline: true };
  const details = error.details as { field?: unknown } | null;
  const field = details && typeof details.field === "string" ? details.field : null;
  return { field, message: error.errors[0] ?? null, offline: error.status === 0 || error.status >= 500 };
}

/**
 * Add a person (B-239, direction C): the person's record before it exists. Their name is typed into the band's title,
 * their job under it, and manager, unit, first day and place sit in the band's top row. The rail holds contact and job
 * details with the company's required fields; the main column offers the manager's open role (B-312), shows what comes
 * up (first day, invitation, the joining checklist) and the team they join. A first day in the past adds someone who
 * already works here; today or later is a joiner.
 */
export default function AddPerson() {
  const t = useTranslations("people.add");
  const english = useLocale() === "en";
  const router = useRouter();
  const dates = useDates();
  const today = todayIso();
  const [form, setForm] = useState<Form>(BLANK);
  const [errors, setErrors] = useState<Errors>({});
  const [review, setReview] = useState<EstablishmentReviewDto | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [managerSearch, setManagerSearch] = useState("");
  const [managerQuery, setManagerQuery] = useState("");
  const [pickedManager, setPickedManager] = useState<ManagerOptionDto | null>(null);
  const [unitFromManager, setUnitFromManager] = useState(false);

  const effective = form.firstDay || today;
  const joiner = !form.firstDay || form.firstDay >= today;
  const units = useOrganizationHierarchy(effective);
  const managers = useManagerOptions(effective, managerQuery);
  const context = useHiringContext(form.managerId || null, effective);
  const jobs = useJobs();
  const places = usePlaces();
  const lists = useCompanyLists();
  const mutations = usePeopleEstablishmentMutations();
  const mutation = joiner ? mutations.hire : mutations.addExisting;
  const busy = mutations.review.isLoading || mutation.isLoading;

  useEffect(() => {
    const timer = setTimeout(() => setManagerQuery(managerSearch.trim()), 250);
    return () => clearTimeout(timer);
  }, [managerSearch]);

  const data = context.data;
  const managerContext = form.managerId ? data?.manager ?? null : null;
  const roles = managerContext?.openRoles ?? [];
  const role = roles.find((item) => item.id === form.openRoleId) ?? null;
  const managerChoices = useMemo(() => {
    const found = managers.data ?? [];
    return pickedManager && !found.some((option) => option.employeeId === pickedManager.employeeId) ? [pickedManager, ...found] : found;
  }, [managers.data, pickedManager]);
  const manager = form.managerId ? (pickedManager?.employeeId === form.managerId ? pickedManager : managerChoices.find((option) => option.employeeId === form.managerId)) ?? null : null;
  const unitList = useMemo(() => flatten(units.data?.roots ?? []), [units.data]);
  const unitName = unitList.find((unit) => unit.id === form.orgUnitId)?.name ?? (form.orgUnitId === managerContext?.orgUnitId ? managerContext?.orgUnitName : null);
  const employmentTypes = (lists.data?.find((list) => list.id === "employment-types")?.values ?? []).filter((value) => !value.isRetired);

  // A manager's unit is where their new report lands unless HR picks another.
  useEffect(() => {
    if (!unitFromManager || !managerContext?.orgUnitId) return;
    setForm((current) => (current.orgUnitId ? current : { ...current, orgUnitId: managerContext.orgUnitId! }));
    setUnitFromManager(false);
  }, [unitFromManager, managerContext]);

  const name = `${form.preferredName.trim() || form.firstName.trim()} ${form.lastName.trim()}`.trim();
  const first = form.preferredName.trim() || form.firstName.trim();
  const email = form.workEmail.trim();
  const emailConflict = review?.conflict?.kind === "WorkEmail" ? review.conflict : null;
  const numberConflict = review?.conflict && review.conflict.kind !== "WorkEmail" ? review.conflict : null;
  const noMail = !email || Boolean(emailConflict);

  const inviteOptions: { value: HireInvite; label: string; disabled: boolean }[] = [
    ...(joiner ? [{ value: "FirstDay" as const, label: t("inviteOnTheDay"), disabled: !data?.canInvite && !data?.invitesOnFirstDay }] : []),
    { value: "Now", label: t("inviteNow"), disabled: !data?.canInvite },
    { value: "Later", label: t("inviteLater"), disabled: false },
  ];
  const inviteDefault = inviteOptions.find((option) => !option.disabled)?.value ?? "Later";
  const invite: HireInvite = noMail ? "Later" : inviteOptions.some((option) => option.value === form.invite && !option.disabled) ? (form.invite as HireInvite) : inviteDefault;

  const clear = (...keys: string[]) => {
    setErrors((current) => {
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
    setFailed(null);
  };
  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    clear(key);
    if (key === "firstName" || key === "lastName" || key === "workEmail" || key === "employeeNumber" || key === "numberMode") setReview(null);
  };

  const pickManager = (option: ManagerOptionDto) => {
    setPickedManager(option);
    setForm((current) => ({ ...current, managerId: option.employeeId, openRoleId: "", orgUnitId: "" }));
    setUnitFromManager(true);
    clear("managerId", "orgUnitId", "openRole");
    setOpen(null);
  };

  const toggleRole = (id: string) => {
    const picked = roles.find((item) => item.id === id);
    if (!picked) return;
    if (form.openRoleId === id) {
      set("openRoleId", "");
      return;
    }
    setForm((current) => ({
      ...current,
      openRoleId: id,
      jobId: picked.jobId,
      jobTitle: picked.jobTitle,
      orgUnitId: picked.orgUnitId,
      firstDay: picked.targetStartDate && picked.targetStartDate >= today ? picked.targetStartDate : current.firstDay,
      placeId: picked.placeId ?? current.placeId,
      placeName: picked.placeName ?? current.placeName,
    }));
    clear("openRole", "jobId", "orgUnitId", "firstDay");
  };

  const validate = () => {
    const next: Errors = {};
    if (!form.firstName.trim()) next.firstName = t("errors.firstName");
    if (!form.lastName.trim()) next.lastName = t("errors.lastName");
    if (email && !isEmailAddress(email)) next.workEmail = t("errors.workEmail");
    if (form.numberMode === "Manual" && !form.employeeNumber.trim()) next.employeeNumber = t("errors.employeeNumber");
    if (!form.jobId) next.jobId = t("errors.job");
    if (!form.orgUnitId) next.orgUnitId = t("errors.unit");
    if (!form.firstDay) next.firstDay = t("errors.firstDay");
    for (const field of data?.requiredFields ?? []) {
      const value = form.fields[field.key];
      if (!(Array.isArray(value) ? value.length : value?.trim())) next[`fields.${field.key}`] = t("errors.required");
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const save = async (confirmed: boolean) => {
    setOpen(null);
    if (!validate()) return;
    setFailed(null);
    try {
      if (!confirmed) {
        const checked = await mutations.review.mutateAsync({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          workEmail: email || null,
          employeeNumberMode: form.numberMode,
          employeeNumber: form.numberMode === "Manual" ? form.employeeNumber.trim() : null,
        });
        if (checked.conflict || checked.suggestions.length > 0) {
          setReview(checked);
          return;
        }
      }
      const fields = Object.fromEntries(Object.entries(form.fields).filter(([, value]) => (Array.isArray(value) ? value.length : value.trim())));
      const common = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        preferredName: form.preferredName.trim() || null,
        workEmail: email || null,
        phone: form.phone.trim() || null,
        employeeNumberMode: form.numberMode,
        employeeNumber: form.numberMode === "Manual" ? form.employeeNumber.trim() : null,
        orgUnitId: form.orgUnitId,
        jobId: form.jobId,
        placeId: form.placeId || null,
        employmentTypeId: form.employmentTypeId || null,
        primaryManagerEmployeeId: form.managerId || null,
        openRoleId: form.openRoleId || null,
        invite,
        fields,
      };
      const result = joiner
        ? await mutations.hire.mutateAsync({ ...common, startDate: form.firstDay })
        : await mutations.addExisting.mutateAsync({ ...common, employmentStart: form.firstDay, workDetailsEffectiveFrom: form.firstDay });
      const again = { label: t("addAnother"), onClick: () => router.push("/people/add") };
      if (result.invitation === "NotSent") toast.warning(t("inviteNotSent", { name: first }), { action: again });
      else toast.success(form.firstDay > today ? t("addedJoiner", { name: first, date: dates.short(form.firstDay) }) : t("added", { name: first }), { action: again });
      router.push(`/people/${result.employeeKey}`);
    } catch (error) {
      const { field, message, offline } = failure(error);
      if (field && message) {
        setErrors((current) => ({ ...current, [field]: english ? message : t("errors.check") }));
        return;
      }
      setFailed(offline ? t("noAnswer") : english && message ? message : t("refused"));
    }
  };

  const twin = !review?.conflict && review?.suggestions.length ? review.suggestions : null;

  // ---- band --------------------------------------------------------------------------------------------------------

  const glance = (key: string, well: ReactNode, label: string, value: string | null | undefined, placeholder: string, menu: ReactNode, width = "w-80") => (
    <div className="min-w-0">
      <Popover open={open === key} onOpenChange={(next) => setOpen(next ? key : null)}>
        <PopoverTrigger asChild>
          <button type="button" id={key} data-invalid={Boolean(errors[key]) || undefined} className={cn(ghost, "-ms-2 flex items-center gap-2.5 px-2 py-1.5")}>
            {well}
            <span className="min-w-0">
              <span className="block type-meta text-muted-foreground">{label}</span>
              <span className={cn("block truncate type-label", !value && "font-normal text-muted-foreground", errors[key] && "text-destructive")}>
                {value || placeholder}
              </span>
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className={cn("p-0", width)}>{menu}</PopoverContent>
      </Popover>
      {errors[key] ? <p className="mt-0.5 type-meta text-destructive">{errors[key]}</p> : null}
    </div>
  );

  const managerMenu = (
    <>
      <SearchBox value={managerSearch} onChange={setManagerSearch} label={t("searchPeople")} />
      <div className="max-h-80 overflow-y-auto p-1.5">
        {managers.isLoading ? (
          <div className="grid gap-2 p-2"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        ) : managerChoices.map((option) => (
          <MenuRow key={option.employeeId} on={option.employeeId === form.managerId} onPick={() => pickManager(option)}>
            <PersonAvatar name={option.displayName} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate type-label">{option.displayName}</span>
              <span className="block truncate type-meta text-muted-foreground">{option.jobTitle} · {option.organizationName}</span>
            </span>
            {option.openRoles > 0 ? (
              <span className="shrink-0 rounded-full border border-primary-ring px-2 py-px type-meta font-semibold text-primary-ink">{t("hiringTag")}</span>
            ) : null}
          </MenuRow>
        ))}
        {!managers.isLoading && managerChoices.length === 0 ? <p className="p-4 text-center type-meta text-muted-foreground">{t("noMatch")}</p> : null}
      </div>
    </>
  );

  const unitMenu = (
    <OrganizationTree
      roots={units.data?.roots ?? []}
      selectedId={form.orgUnitId || null}
      onSelect={(id) => {
        if (!id) return;
        set("orgUnitId", id);
        setOpen(null);
      }}
      emptyLabel={t("noMatch")}
    />
  );

  const dayMenu = (
    <Calendar
      mode="single"
      autoFocus
      selected={form.firstDay ? new Date(`${form.firstDay}T00:00:00`) : undefined}
      defaultMonth={new Date(`${form.firstDay || role?.targetStartDate || today}T00:00:00`)}
      onSelect={(date) => {
        if (!date) return;
        const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        set("firstDay", iso);
        setOpen(null);
      }}
    />
  );

  const placeMenu = (
    <ListMenu
      items={(places.data ?? []).filter((place) => !place.isRetired)}
      value={form.placeId}
      search={t("searchPlaces")}
      empty={t("noMatch")}
      onPick={(place) => {
        setForm((current) => ({ ...current, placeId: place.id === current.placeId ? "" : place.id, placeName: place.id === current.placeId ? "" : place.name }));
        setOpen(null);
      }}
    />
  );

  const band = (
    <section aria-labelledby="add-title" className="grid gap-x-7 rounded-surface bg-card px-8 pt-7 pb-6 sm:grid-cols-[8rem_minmax(0,1fr)]">
      <h1 id="add-title" className="sr-only">{name || t("newPerson")}</h1>
      {name ? (
        <PersonAvatar name={name} size="profile" className="mb-4 size-32 font-editorial text-[2.75rem] sm:mb-0" />
      ) : (
        <span className="mb-4 grid size-32 place-items-center rounded-full border-[1.5px] border-dashed border-muted-foreground/50 text-muted-foreground sm:mb-0">
          <UserPlus className="size-9" aria-hidden />
        </span>
      )}
      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-2.5">
              {(["firstName", "lastName"] as const).map((key) => (
                <input
                  key={key}
                  id={key}
                  autoFocus={key === "firstName"}
                  value={form[key]}
                  onChange={(event) => set(key, event.target.value)}
                  placeholder={t(key)}
                  aria-label={t(key)}
                  aria-invalid={Boolean(errors[key]) || undefined}
                  autoComplete={key === "firstName" ? "given-name" : "family-name"}
                  className="field-sizing-content min-w-[4ch] rounded-none border-0 border-b-[1.5px] border-dashed border-transparent bg-transparent px-0.5 font-editorial text-[2.25rem] leading-tight font-medium tracking-[-0.015em] text-foreground outline-none placeholder:text-muted-foreground/65 placeholder-shown:border-muted-foreground/45 focus:border-primary aria-invalid:border-destructive"
                />
              ))}
            </div>
            {errors.firstName || errors.lastName ? <p className="mt-1 type-meta text-destructive">{errors.firstName ?? errors.lastName}</p> : null}
            <div className="mt-1.5">
              <Popover open={open === "jobId"} onOpenChange={(next) => setOpen(next ? "jobId" : null)}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    id="jobId"
                    data-invalid={Boolean(errors.jobId) || undefined}
                    className={cn(ghost, "-ms-2 inline-flex items-center gap-1.5 px-2 py-1 type-subsection-title", form.jobTitle ? "text-foreground" : "text-muted-foreground", errors.jobId && "text-destructive")}
                  >
                    {form.jobTitle || t("chooseJob")}
                    <ChevronDown className="size-4" aria-hidden />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80 p-0">
                  <ListMenu
                    items={(jobs.data ?? []).filter((job) => !job.isRetired).map((job) => ({ id: job.id, name: job.title }))}
                    value={form.jobId}
                    search={t("searchJobs")}
                    empty={t("noMatch")}
                    onPick={(job) => {
                      setForm((current) => ({
                        ...current,
                        jobId: job.id,
                        jobTitle: job.name,
                        // Another job is another role: the open one is no longer the one they fill.
                        openRoleId: role && role.jobId !== job.id ? "" : current.openRoleId,
                      }));
                      clear("jobId");
                      setOpen(null);
                    }}
                  />
                </PopoverContent>
              </Popover>
              {errors.jobId ? <p className="type-meta text-destructive">{errors.jobId}</p> : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" asChild><Link href="/people">{t("cancel")}</Link></Button>
            <AsyncButton pending={busy} onClick={() => void save(Boolean(twin))}>{first ? t("addNamed", { name: first }) : t("addPerson")}</AsyncButton>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-1.5">
          {glance(
            "managerId",
            manager ? <PersonAvatar name={manager.displayName} size="md" /> : <Well dashed><CircleUserRound aria-hidden /></Well>,
            t("manager"), manager?.displayName, t("choose"), managerMenu, "w-[26rem]",
          )}
          {glance("orgUnitId", <Well><Network aria-hidden /></Well>, t("unit"), unitName, t("choose"), unitMenu, "w-[30rem]")}
          {glance(
            "firstDay", <Well><CalendarDays aria-hidden /></Well>, joiner ? t("starts") : t("joined"),
            form.firstDay ? (form.firstDay === today ? t("today") : dates.long(form.firstDay)) : null, t("pickDate"), dayMenu, "w-auto",
          )}
          {glance("placeId", <Well><MapPin aria-hidden /></Well>, t("place"), form.placeName, t("optional"), placeMenu)}
        </div>
      </div>
    </section>
  );

  // ---- rail --------------------------------------------------------------------------------------------------------

  const text = (key: "workEmail" | "phone" | "preferredName", label: string, extra?: ReactNode) => (
    <Field data-invalid={Boolean(errors[key] || (key === "workEmail" && emailConflict))}>
      <FieldLabel htmlFor={key}>{label} <span className="font-normal text-muted-foreground">{t("optionalLower")}</span></FieldLabel>
      <Input id={key} value={form[key]} onChange={(event) => set(key, event.target.value)}
        aria-invalid={Boolean(errors[key] || (key === "workEmail" && emailConflict))}
        type={key === "workEmail" ? "email" : key === "phone" ? "tel" : "text"}
        autoComplete={key === "workEmail" ? "email" : key === "phone" ? "tel" : "nickname"} />
      {extra}
      <FieldError>{errors[key]}</FieldError>
    </Field>
  );

  const rail = (
    <aside className="grid content-start">
      <div className="grid gap-3 pt-1 pb-4">
        <h2 className="type-subsection-title">{t("contact")}</h2>
        {text("workEmail", t("workEmail"), emailConflict ? (
          <p className="flex items-center gap-1.5 type-meta text-destructive">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            <span>
              {t("emailTaken", { name: emailConflict.displayName })}{" "}
              <Link href={`/people/${emailConflict.employeeKey}`} className="text-foreground underline underline-offset-3">
                {t("openNamed", { name: emailConflict.displayName.split(" ")[0] ?? emailConflict.displayName })}
              </Link>
            </span>
          </p>
        ) : null)}
        {text("phone", t("phone"))}
        {text("preferredName", t("preferredName"))}
      </div>
      <div className="grid gap-3 border-t border-border pt-4 pb-4">
        <h2 className="type-subsection-title">{t("job")}</h2>
        {employmentTypes.length ? (
          <Field>
            <FieldLabel>{t("employmentType")} <span className="font-normal text-muted-foreground">{t("optionalLower")}</span></FieldLabel>
            <QuickPicks
              label={t("employmentType")}
              value={form.employmentTypeId}
              onPick={(value) => set("employmentTypeId", value === form.employmentTypeId ? "" : value)}
              options={employmentTypes.map((value) => ({ value: value.id, label: value.label }))}
            />
          </Field>
        ) : null}
        <Field data-invalid={Boolean(errors.employeeNumber || numberConflict)}>
          <FieldLabel>{t("employeeNumber")}</FieldLabel>
          <div className="flex flex-wrap items-center gap-2.5">
            <Segmented
              label={t("employeeNumber")}
              value={form.numberMode}
              onChange={(value) => set("numberMode", value)}
              options={[{ value: "Generated", label: t("nextNumber") }, { value: "Manual", label: t("theirOwn") }]}
            />
            {form.numberMode === "Manual" ? (
              <Input id="employeeNumber" value={form.employeeNumber} onChange={(event) => set("employeeNumber", event.target.value)}
                aria-label={t("employeeNumber")} aria-invalid={Boolean(errors.employeeNumber || numberConflict)} className="w-36 font-mono uppercase" />
            ) : null}
          </div>
          <FieldError>{errors.employeeNumber ?? (numberConflict ? numberConflict.message : undefined)}</FieldError>
        </Field>
        {(data?.requiredFields ?? []).map((field) => (
          <CompanyField
            key={field.key}
            field={field}
            value={form.fields[field.key]}
            error={errors[`fields.${field.key}`]}
            onChange={(value) => {
              setForm((current) => ({ ...current, fields: { ...current.fields, [field.key]: value } }));
              clear(`fields.${field.key}`);
            }}
          />
        ))}
      </div>
    </aside>
  );

  // ---- main column -------------------------------------------------------------------------------------------------

  const managerFirst = manager?.displayName.split(" ")[0] ?? "";
  const offer = roles.length && manager ? (
    <section className="grid gap-3 rounded-surface bg-card px-6 pt-5.5 pb-6" aria-labelledby="add-hiring">
      <h2 id="add-hiring" className="type-section-title">{t("hiring", { name: managerFirst })}</h2>
      {roles.map((item) => {
        const on = item.id === form.openRoleId;
        return (
          <button
            key={item.id}
            type="button"
            role="checkbox"
            aria-checked={on}
            onClick={() => toggleRole(item.id)}
            className={cn(
              "flex w-full animate-in items-center gap-3.5 rounded-control border px-3.5 py-3 text-start fade-in-0 slide-in-from-top-1 outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "border-primary-ring bg-primary-tint" : "border-border bg-inlay hover:border-foreground/25",
            )}
          >
            <span className={cn("grid size-9 shrink-0 place-items-center rounded-nested border-[1.5px] [&_svg]:size-4", on ? "border-primary-ring text-primary-ink" : "border-dashed border-muted-foreground/60 text-muted-foreground")}>
              <Briefcase aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block type-label">{t("fillsRole", { job: item.jobTitle })}</span>
              <span className="block truncate type-meta text-muted-foreground">
                {[item.orgUnitName, item.placeName, item.targetStartDate ? t("roleFrom", { date: dates.short(item.targetStartDate) }) : null].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className={cn("grid size-5 shrink-0 place-items-center rounded-detail border-[1.5px]", on ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
              {on ? <Check className="size-3.5" aria-hidden /> : null}
            </span>
          </button>
        );
      })}
      {errors.openRole ? <p className="type-meta text-destructive">{errors.openRole}</p> : null}
    </section>
  ) : null;

  const managerAvatar = (size: "xs" | "sm") => manager ? <PersonAvatar name={manager.displayName} size={size} /> : <span className="size-6 shrink-0 rounded-full border-[1.5px] border-dashed border-muted-foreground/50" />;
  const personAvatar = (size: "xs" | "sm") => name ? <PersonAvatar name={name} size={size} /> : <span className={cn("shrink-0 rounded-full border-[1.5px] border-dashed border-muted-foreground/50", size === "xs" ? "size-6" : "size-8")} />;
  const owner = (who: string) =>
    who === "hr" ? (
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-inlay text-[0.5625rem] font-semibold text-muted-foreground">{t("hrShort")}</span>
    ) : who === "manager" ? managerAvatar("xs") : personAvatar("xs");

  const checklist = (data?.checklist ?? []).slice().sort((a, b) => a.offsetDays - b.offsetDays);
  const limit = 8;
  const groups = [
    { label: t("before"), rows: checklist.filter((task) => task.offsetDays < 0) },
    { label: t("firstDayGroup"), rows: checklist.filter((task) => task.offsetDays === 0) },
    { label: t("firstWeek"), rows: checklist.filter((task) => task.offsetDays > 0) },
  ];
  let shown = 0;

  const inviteLine = (() => {
    if (noMail) return { title: t("noInvite"), meta: t("noInviteHint", { name: first || t("them") }) };
    const meta = invite === "FirstDay"
      ? (form.firstDay ? t("inviteOn", { date: dates.short(form.firstDay) }) : t("inviteFirstDay"))
      : invite === "Now" ? t("inviteAsap") : t("inviteWhenYouChoose");
    return { title: t("inviteTo", { email }), meta };
  })();

  const coming = (
    <section className="grid gap-3.5 rounded-surface bg-card px-6 pt-5.5 pb-6" aria-labelledby="add-coming">
      <div className="flex min-h-7 flex-wrap items-center justify-between gap-3">
        <h2 id="add-coming" className="type-section-title">{t("comingUp")}</h2>
        <Segmented
          label={t("invite")}
          size="sm"
          value={noMail ? null : invite}
          onChange={(value) => set("invite", value)}
          disabled={noMail}
          options={inviteOptions.map((option) => ({ value: option.value, label: option.label, disabled: option.disabled }))}
        />
      </div>
      <div className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-4">
        <div className="w-16 overflow-hidden rounded-inset bg-card ring-1 ring-border text-center">
          <small className={cn("block pt-1 pb-0.5 text-[0.6875rem] font-semibold", form.firstDay ? "bg-primary-tint text-primary-ink" : "bg-inlay text-muted-foreground")}>
            {form.firstDay ? dates.weekday(form.firstDay) : t("dayTile")}
          </small>
          <b className={cn("block pt-1 text-[1.625rem] leading-[1.1] font-semibold tabular-nums", !form.firstDay && "text-muted-foreground")}>
            {form.firstDay ? asDate(form.firstDay).getUTCDate() : "?"}
          </b>
          <span className="block pb-1.5 text-[0.6875rem] text-muted-foreground">{form.firstDay ? dates.monthYear(form.firstDay) : t("monthTile")}</span>
        </div>
        <div className="min-w-0">
          <p className="type-section-title">
            {!joiner ? t("worksSince", { date: dates.full(form.firstDay) }) : form.firstDay ? (first ? t("firstDayOf", { name: first }) : t("theirFirstDay")) : t("firstDayTitle")}
          </p>
          <p className="type-meta text-muted-foreground">{form.firstDay ? dates.relative(form.firstDay) : t("notSet")}</p>
        </div>
      </div>
      <div className="flex items-center gap-2.5 rounded-control bg-inlay px-3 py-2.5">
        <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate type-label">{inviteLine.title}</p>
          <p className="truncate type-meta text-muted-foreground">{inviteLine.meta}</p>
        </div>
      </div>
      {errors.invite ? <p className="type-meta text-destructive">{errors.invite}</p> : null}
      {joiner && checklist.length ? (
        <div className="grid gap-0.5">
          {groups.map((group) => {
            if (!group.rows.length || shown >= limit) return null;
            const rows = group.rows.slice(0, limit - shown);
            shown += rows.length;
            return (
              <div key={group.label} className="grid gap-0.5">
                <p className="pt-2 pb-1 type-meta-strong text-muted-foreground">{group.label}</p>
                {rows.map((task) => {
                  const due = form.firstDay ? addDays(form.firstDay, task.offsetDays) : "";
                  return (
                    <div key={task.id} className="grid grid-cols-[4.625rem_1.5rem_minmax(0,1fr)] items-center gap-2.5 py-1.25">
                      <span className={cn("type-meta tabular-nums", task.offsetDays === 0 ? "font-semibold text-primary-ink" : "text-muted-foreground")}>
                        {due ? (due <= today ? t("now") : dates.short(due)) : " "}
                      </span>
                      {owner(task.owner)}
                      <span className="truncate type-body">{task.title}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {checklist.length > shown ? <p className="ps-21 type-meta text-muted-foreground">{t("more", { count: checklist.length - shown })}</p> : null}
        </div>
      ) : null}
    </section>
  );

  const node = "flex min-w-0 w-full items-center gap-2.5 rounded-inset bg-inlay px-3 py-2.5";
  const team = (
    <section className="grid gap-4 rounded-surface bg-card px-6 pt-5.5 pb-6" aria-labelledby="add-team">
      {manager ? (
        <div className="flex min-h-7 items-center justify-between gap-3">
          <h2 id="add-team" className="type-subsection-title">{t("team", { name: managerFirst })}</h2>
          {managerContext?.orgUnitName ? <p className="type-meta text-muted-foreground">{managerContext.orgUnitName}</p> : null}
        </div>
      ) : (
        <h2 id="add-team" className="type-subsection-title">{t("teamTitle")}</h2>
      )}
      {manager ? (
        <div className="grid justify-items-center">
          <div className={cn(node, "w-auto max-w-full px-3.5")}>
            <PersonAvatar name={manager.displayName} size="sm" />
            <div className="min-w-0">
              <p className="truncate type-label">{manager.displayName}</p>
              <p className="truncate type-meta text-muted-foreground">{manager.jobTitle}</p>
            </div>
          </div>
          <div className="h-4 w-[1.5px] bg-border" />
          <div className="grid w-full grid-cols-2 gap-2 border-t-[1.5px] border-border pt-4">
            <div key={`${name}-${form.jobTitle}`} className={cn(node, "animate-in bg-primary-tint ring-[1.5px] ring-primary duration-400 zoom-in-95 fade-in-30")}>
              {personAvatar("sm")}
              <div className="min-w-0">
                <p className="truncate type-label">{name || t("newPerson")}</p>
                <p className="truncate type-meta text-muted-foreground">{form.jobTitle || t("noJobYet")}</p>
              </div>
              {joiner ? <span className="ms-auto shrink-0 text-[0.6875rem] font-semibold text-primary-ink">{t("newTag")}</span> : null}
            </div>
            {roles.filter((item) => item.id !== form.openRoleId).map((item) => (
              <div key={item.id} className={cn(node, "border-[1.5px] border-dashed border-muted-foreground/50 bg-transparent")}>
                <span className="size-6.5 shrink-0 rounded-full border-[1.5px] border-dashed border-muted-foreground/55" />
                <div className="min-w-0">
                  <p className="truncate type-label">{item.jobTitle}</p>
                  <p className="truncate type-meta text-muted-foreground">{t("openRole")}</p>
                </div>
              </div>
            ))}
            {(managerContext?.team ?? []).map((member) => (
              <div key={member.employeeKey} className={node}>
                <PersonAvatar name={member.displayName} size="sm" />
                <div className="min-w-0">
                  <p className="truncate type-label">{member.displayName}</p>
                  <p className="truncate type-meta text-muted-foreground">{member.jobTitle}</p>
                </div>
              </div>
            ))}
            {managerContext && managerContext.teamCount > managerContext.team.length ? (
              <div className={cn(node, "col-span-2 justify-center")}>
                <p className="type-meta text-muted-foreground">{t("moreReports", { count: managerContext.teamCount - managerContext.team.length, name: managerFirst })}</p>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className={cn(node, "border-[1.5px] border-dashed border-muted-foreground/50 bg-transparent")}>
          <span className="size-6.5 shrink-0 rounded-full border-[1.5px] border-dashed border-muted-foreground/55" />
          <p className="type-label text-muted-foreground">{t("noManagerYet")}</p>
        </div>
      )}
    </section>
  );

  return (
    <PageContainer width="wide" className="pb-16">
      <Link href="/people" className="mb-3 inline-flex items-center gap-1.5 type-meta text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
        <ArrowLeft className="size-3.5" aria-hidden /> {t("back")}
      </Link>

      {failed || twin ? (
        <div className="mb-4.5 grid gap-3">
          {failed ? (
            <div role="alert" className="flex items-center gap-3 rounded-control bg-destructive/12 px-4 py-3">
              <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="type-label">{t("couldntAdd", { name: first || t("them") })}</p>
                <p className="type-meta text-muted-foreground">{failed}</p>
              </div>
              <AsyncButton size="sm" variant="outline" pending={busy} onClick={() => void save(Boolean(twin))}>{t("tryAgain")}</AsyncButton>
            </div>
          ) : null}
          {twin ? (
            <div role="alert" className="grid gap-2.5 rounded-control bg-inlay px-3.5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="type-label">{t("sameName")}</p>
                <AsyncButton size="sm" variant="outline" pending={mutation.isLoading} onClick={() => void save(true)}>{t("addAnyway", { name: first })}</AsyncButton>
              </div>
              {twin.map((suggestion) => (
                <Link key={suggestion.employeeKey} href={`/people/${suggestion.employeeKey}`}
                  className="flex items-center gap-2.5 rounded-nested bg-card px-2.5 py-2 hover:bg-secondary">
                  <PersonAvatar name={suggestion.displayName} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block type-label">{suggestion.displayName}</span>
                    <span className="block type-meta text-muted-foreground">{suggestion.employeeNumber} · {suggestion.reason}</span>
                  </span>
                  <span className="type-label text-primary-ink">{t("open")}</span>
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save(Boolean(twin));
        }}
      >
        {band}
        <div className="mt-7 grid items-start gap-8 lg:grid-cols-[18.75rem_minmax(0,1fr)]">
          {rail}
          <div className="grid min-w-0 gap-4.5">
            {context.error ? <p role="alert" className="type-meta text-destructive">{t("contextFailed")}</p> : null}
            {offer}
            {coming}
            {team}
          </div>
        </div>
        <button type="submit" hidden />
      </form>
    </PageContainer>
  );
}
