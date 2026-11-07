"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Button,
  DatePicker,
  Field,
  FieldError,
  FieldLabel,
  Input,
  PersonAvatar,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from "@repo/ds";
import { QuickPicks, Segmented } from "@repo/ds/choice";
import { AsyncButton, PageContainer, Section, StatusBadge } from "@repo/ds/shell";
import { ApiError, type EstablishmentReviewDto, type ManagerOptionDto, type OrganizationHierarchyNodeDto } from "@repo/api";
import { toast } from "sonner";
import { ArrowLeft, Building2, CalendarDays, ChevronDown, MapPin } from "lucide-react";
import { JobPicker, PlacePicker } from "@/features/catalog/components/catalog-pickers";
import { useCompanyLists } from "@/features/catalog/api/use-catalog";
import { useOrganizationHierarchy } from "@/features/organization/api/use-organization";
import { OrganizationTree } from "@/features/organization/components/organization-tree";
import { usePeopleEstablishmentMutations } from "../api/use-people";
import { useManagerOptions } from "../changes/use-changes";
import { ManagerPicker } from "./workforce-pickers";
import { Monogram, useWorkforceDate } from "./workforce-ui";

const today = () => new Date().toISOString().slice(0, 10);

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
  managerEmployeeId: string;
};

type Errors = Partial<Record<keyof Form | "form", string>>;

function flatten(nodes: OrganizationHierarchyNodeDto[]): { id: string; name: string }[] {
  return nodes.flatMap((node) => [{ id: node.unit.id, name: node.unit.name }, ...flatten(node.children)]);
}

function UnitPicker({ roots, value, onChange, invalid }: { roots: OrganizationHierarchyNodeDto[]; value: string; onChange: (id: string) => void; invalid: boolean }) {
  const t = useTranslations("people.add");
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => flatten(roots).find((unit) => unit.id === value), [roots, value]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id="unit" type="button" variant="outline" aria-invalid={invalid} className="w-full justify-between bg-inlay font-normal">
          <span className="flex min-w-0 items-center gap-2">
            <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className={cn("truncate", !selected && "text-muted-foreground")}>{selected?.name ?? t("pickUnit")}</span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(30rem,calc(100vw-2rem))] p-0">
        <OrganizationTree
          roots={roots}
          selectedId={value || null}
          onSelect={(id) => {
            if (!id) return;
            onChange(id);
            setOpen(false);
          }}
          emptyLabel={t("noUnit")}
        />
      </PopoverContent>
    </Popover>
  );
}

function refusal(error: unknown, fallback: string, english: boolean) {
  if (!english) return fallback;
  if (error instanceof ApiError) return error.errors[0] ?? fallback;
  return fallback;
}

/**
 * Add a person (B-199): the person page's band fills in as you type, and the form under it is two sections, who
 * they are and their job. A first day in the past adds someone who already works here; today or later is a joiner.
 */
export default function AddPerson() {
  const t = useTranslations("people.add");
  const english = useLocale() === "en";
  const router = useRouter();
  const day = useWorkforceDate();
  const [form, setForm] = useState<Form>({
    firstName: "", lastName: "", preferredName: "", workEmail: "", phone: "",
    numberMode: "Generated", employeeNumber: "", firstDay: today(), employmentTypeId: "",
    orgUnitId: "", jobId: "", jobTitle: "", placeId: "", placeName: "", managerEmployeeId: "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [review, setReview] = useState<EstablishmentReviewDto | null>(null);
  const [managerSearch, setManagerSearch] = useState("");
  const [pickedManager, setPickedManager] = useState<ManagerOptionDto | null>(null);
  const effective = form.firstDay || today();
  const units = useOrganizationHierarchy(effective);
  const managers = useManagerOptions(effective, managerSearch);
  const lists = useCompanyLists();
  const mutations = usePeopleEstablishmentMutations();
  const joiner = form.firstDay >= today();
  const mutation = joiner ? mutations.hire : mutations.addExisting;
  const managerChoices = useMemo(() => {
    const found = managers.data ?? [];
    return pickedManager && !found.some((option) => option.employeeId === pickedManager.employeeId) ? [pickedManager, ...found] : found;
  }, [managers.data, pickedManager]);
  const employmentTypes = (lists.data?.find((list) => list.id === "employment-types")?.values ?? []).filter((value) => !value.isRetired);
  const unitName = useMemo(() => flatten(units.data?.roots ?? []).find((unit) => unit.id === form.orgUnitId)?.name, [units.data, form.orgUnitId]);

  const name = `${form.preferredName.trim() || form.firstName.trim()} ${form.lastName.trim()}`.trim();
  const first = form.preferredName.trim() || form.firstName.trim();

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((current) => {
      const next = { ...current, [key]: value };
      // The structure and managers are read on the first day; a new day asks again.
      if (key === "firstDay") {
        next.orgUnitId = "";
        next.managerEmployeeId = "";
      }
      return next;
    });
    setErrors((current) => ({ ...current, [key]: undefined, form: undefined }));
    setReview(null);
  };

  const validate = () => {
    const next: Errors = {};
    if (!form.firstName.trim()) next.firstName = t("errors.firstName");
    if (!form.lastName.trim()) next.lastName = t("errors.lastName");
    if (form.workEmail && !/^\S+@\S+\.\S+$/.test(form.workEmail)) next.workEmail = t("errors.workEmail");
    if (form.numberMode === "Manual" && !form.employeeNumber.trim()) next.employeeNumber = t("errors.employeeNumber");
    if (!form.firstDay) next.firstDay = t("errors.firstDay");
    if (!form.jobId) next.jobId = t("errors.job");
    if (!form.orgUnitId) next.orgUnitId = t("errors.unit");
    setErrors(next);
    if (Object.keys(next).length) window.requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
    return Object.keys(next).length === 0;
  };

  const save = async (confirmed: boolean) => {
    if (!validate()) return;
    try {
      if (!confirmed) {
        const checked = await mutations.review.mutateAsync({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          workEmail: form.workEmail.trim() || null,
          employeeNumberMode: form.numberMode,
          employeeNumber: form.numberMode === "Manual" ? form.employeeNumber.trim() : null,
        });
        if (checked.conflict || checked.suggestions.length > 0) {
          setReview(checked);
          return;
        }
      }
      const common = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        preferredName: form.preferredName.trim() || null,
        workEmail: form.workEmail.trim() || null,
        phone: form.phone.trim() || null,
        employeeNumberMode: form.numberMode,
        employeeNumber: form.numberMode === "Manual" ? form.employeeNumber.trim() : null,
        orgUnitId: form.orgUnitId,
        jobId: form.jobId,
        placeId: form.placeId || null,
        employmentTypeId: form.employmentTypeId || null,
        primaryManagerEmployeeId: form.managerEmployeeId || null,
      };
      const result = joiner
        ? await mutations.hire.mutateAsync({ ...common, startDate: form.firstDay })
        : await mutations.addExisting.mutateAsync({ ...common, employmentStart: form.firstDay, workDetailsEffectiveFrom: form.firstDay });
      toast.success(joiner && form.firstDay > today() ? t("addedJoiner", { name: first, date: day(form.firstDay) }) : t("added", { name: first }));
      router.push(`/people/${result.employeeKey}`);
    } catch (error) {
      setErrors({ form: refusal(error, t("failed"), english) });
    }
  };

  const manager = managerChoices.find((option) => option.employeeId === form.managerEmployeeId);
  const busy = mutations.review.isLoading || mutation.isLoading;

  return (
    <PageContainer width="wide" className="max-w-5xl pb-16">
      <Link href="/people" className="mb-4 inline-flex items-center gap-2 type-meta text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> {t("back")}
      </Link>

      <section aria-labelledby="add-name" className="rounded-surface bg-section px-6 py-6 sm:grid sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-x-7 sm:px-8 sm:py-7">
        <PersonAvatar name={name || "?"} size="profile" className="mb-4 size-24 border-2 font-editorial text-3xl font-medium sm:mb-0 sm:size-[7.5rem] sm:text-[2.5rem]" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 id="add-name" className={cn("type-display truncate sm:text-[2.25rem]", !name && "text-muted-foreground")}>{name || t("newPerson")}</h1>
              <p className={cn("mt-1.5 type-subsection-title", form.jobTitle ? "text-foreground" : "text-muted-foreground")}>{form.jobTitle || t("noJobYet")}</p>
              {unitName ? <p className="mt-1 type-body text-muted-foreground">{unitName}</p> : null}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" asChild><Link href="/people">{t("cancel")}</Link></Button>
              <AsyncButton pending={busy} onClick={() => void save(false)}>{first ? t("addNamed", { name: first }) : t("addPerson")}</AsyncButton>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-x-10 gap-y-3">
            {manager ? (
              <span className="flex items-center gap-2.5">
                <Monogram name={manager.displayName} size="md" />
                <span>
                  <span className="block type-meta text-muted-foreground">{t("manager")}</span>
                  <span className="block type-label">{manager.displayName}</span>
                </span>
              </span>
            ) : null}
            {form.firstDay ? (
              <span className="flex items-center gap-2.5">
                <span className="grid size-9 place-items-center rounded-full bg-inlay text-muted-foreground"><CalendarDays className="size-4" aria-hidden /></span>
                <span>
                  <span className="block type-meta text-muted-foreground">{joiner ? t("starts") : t("joined")}</span>
                  <span className="block type-label">{form.firstDay === today() ? t("today") : day(form.firstDay)}</span>
                </span>
              </span>
            ) : null}
            {form.placeName ? (
              <span className="flex items-center gap-2.5">
                <span className="grid size-9 place-items-center rounded-full bg-inlay text-muted-foreground"><MapPin className="size-4" aria-hidden /></span>
                <span>
                  <span className="block type-meta text-muted-foreground">{t("place")}</span>
                  <span className="block type-label">{form.placeName}</span>
                </span>
              </span>
            ) : null}
          </div>
        </div>
      </section>

      {errors.form ? (
        <p role="alert" className="mt-5 rounded-control bg-destructive/10 px-4 py-3 type-body text-destructive">{errors.form}</p>
      ) : null}
      {review?.conflict ? (
        <div role="alert" className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-surface bg-card px-5 py-4">
          <p className="type-body"><span className="font-semibold text-destructive">{t("exists")}</span> {review.conflict.message}</p>
          <Button variant="outline" size="sm" asChild><Link href={`/people/${review.conflict.employeeKey}`}>{t("open", { name: review.conflict.displayName })}</Link></Button>
        </div>
      ) : review?.suggestions.length ? (
        <div className="mt-5 rounded-surface bg-card px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="type-label font-semibold">{t("maybe")}</p>
            <AsyncButton size="sm" pending={mutation.isLoading} onClick={() => void save(true)}>{t("addAnyway", { name: first })}</AsyncButton>
          </div>
          <ul className="mt-3 grid gap-2">
            {review.suggestions.map((suggestion) => (
              <li key={suggestion.employeeKey}>
                <Link href={`/people/${suggestion.employeeKey}`} className="flex items-center gap-3 rounded-inset bg-inlay px-3 py-2 hover:bg-inlay/70">
                  <Monogram name={suggestion.displayName} size="sm" />
                  <span className="type-label">{suggestion.displayName}</span>
                  <span className="type-meta text-muted-foreground">{suggestion.reason}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save(false);
        }}
        className="mt-8 flex flex-col gap-6"
      >
        <Section title={t("who")}>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field data-invalid={Boolean(errors.firstName)}>
              <FieldLabel htmlFor="firstName">{t("firstName")}</FieldLabel>
              <Input id="firstName" autoFocus value={form.firstName} onChange={(event) => set("firstName", event.target.value)} aria-invalid={Boolean(errors.firstName)} autoComplete="given-name" />
              <FieldError>{errors.firstName}</FieldError>
            </Field>
            <Field data-invalid={Boolean(errors.lastName)}>
              <FieldLabel htmlFor="lastName">{t("lastName")}</FieldLabel>
              <Input id="lastName" value={form.lastName} onChange={(event) => set("lastName", event.target.value)} aria-invalid={Boolean(errors.lastName)} autoComplete="family-name" />
              <FieldError>{errors.lastName}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="preferredName">{t("preferredName")} <span className="font-normal text-muted-foreground">{t("optional")}</span></FieldLabel>
              <Input id="preferredName" value={form.preferredName} onChange={(event) => set("preferredName", event.target.value)} />
            </Field>
            <Field data-invalid={Boolean(errors.workEmail)}>
              <FieldLabel htmlFor="workEmail">{t("workEmail")} <span className="font-normal text-muted-foreground">{t("optional")}</span></FieldLabel>
              <Input id="workEmail" type="email" value={form.workEmail} onChange={(event) => set("workEmail", event.target.value)} aria-invalid={Boolean(errors.workEmail)} autoComplete="email" />
              <FieldError>{errors.workEmail}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="phone">{t("phone")} <span className="font-normal text-muted-foreground">{t("optional")}</span></FieldLabel>
              <Input id="phone" value={form.phone} onChange={(event) => set("phone", event.target.value)} autoComplete="tel" />
            </Field>
            <Field data-invalid={Boolean(errors.employeeNumber)}>
              <FieldLabel>{t("employeeNumber")}</FieldLabel>
              <div className="flex flex-wrap items-center gap-2">
                <Segmented
                  label={t("employeeNumber")}
                  value={form.numberMode}
                  onChange={(value) => set("numberMode", value)}
                  options={[{ value: "Generated", label: t("generated") }, { value: "Manual", label: t("manual") }]}
                />
                {form.numberMode === "Manual" ? (
                  <Input
                    value={form.employeeNumber}
                    onChange={(event) => set("employeeNumber", event.target.value)}
                    aria-label={t("employeeNumber")}
                    aria-invalid={Boolean(errors.employeeNumber)}
                    className="w-40 font-mono uppercase"
                  />
                ) : null}
              </div>
              <FieldError>{errors.employeeNumber}</FieldError>
            </Field>
          </div>
        </Section>

        <Section title={t("job")}>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field data-invalid={Boolean(errors.firstDay)}>
              <FieldLabel htmlFor="firstDay">{t("firstDay")}</FieldLabel>
              <DatePicker id="firstDay" value={form.firstDay} onChange={(value) => set("firstDay", value)} aria-invalid={Boolean(errors.firstDay)} />
              {form.firstDay && form.firstDay > today() ? <StatusBadge tone="info" dot className="mt-1 justify-self-start">{t("joinerBadge")}</StatusBadge> : null}
              <FieldError>{errors.firstDay}</FieldError>
            </Field>
            <Field data-invalid={Boolean(errors.jobId)}>
              <FieldLabel htmlFor="jobId">{t("jobTitle")}</FieldLabel>
              <JobPicker id="jobId" value={form.jobId || null} onChange={(job) => { set("jobId", job.id); setForm((current) => ({ ...current, jobTitle: job.title })); }} invalid={Boolean(errors.jobId)} />
              <FieldError>{errors.jobId}</FieldError>
            </Field>
            <Field data-invalid={Boolean(errors.orgUnitId)}>
              <FieldLabel htmlFor="unit">{t("unit")}</FieldLabel>
              <UnitPicker roots={units.data?.roots ?? []} value={form.orgUnitId} onChange={(id) => set("orgUnitId", id)} invalid={Boolean(errors.orgUnitId)} />
              <FieldError>{errors.orgUnitId}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="placeId">{t("place")} <span className="font-normal text-muted-foreground">{t("optional")}</span></FieldLabel>
              <PlacePicker id="placeId" value={form.placeId || null} onChange={(place) => setForm((current) => ({ ...current, placeId: place?.id ?? "", placeName: place?.name ?? "" }))} />
            </Field>
            <Field>
              <FieldLabel>{t("manager")} <span className="font-normal text-muted-foreground">{t("optional")}</span></FieldLabel>
              <ManagerPicker
                options={managerChoices}
                value={form.managerEmployeeId}
                onChange={(value) => {
                  setPickedManager(managerChoices.find((option) => option.employeeId === value) ?? null);
                  set("managerEmployeeId", value);
                }}
                loading={managers.isLoading}
                invalid={false}
                onQueryChange={setManagerSearch}
              />
            </Field>
            {employmentTypes.length ? (
              <Field>
                <FieldLabel>{t("employmentType")} <span className="font-normal text-muted-foreground">{t("optional")}</span></FieldLabel>
                <QuickPicks
                  label={t("employmentType")}
                  value={form.employmentTypeId}
                  onPick={(value) => set("employmentTypeId", value === form.employmentTypeId ? "" : value)}
                  options={employmentTypes.map((value) => ({ value: value.id, label: value.label }))}
                />
              </Field>
            ) : null}
          </div>
        </Section>
        <button type="submit" hidden />
      </form>
    </PageContainer>
  );
}
