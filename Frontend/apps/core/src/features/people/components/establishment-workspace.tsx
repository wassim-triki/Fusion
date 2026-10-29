"use client";

import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Field,
  FieldError,
  FieldLabel,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from "@repo/ds";
import { Segmented } from "@repo/ds/choice";
import { PageContainer, StatusBadge } from "@repo/ds/shell";
import type {
  AddExistingEmployeeRequest,
  EstablishmentReviewDto,
  HireEmployeeRequest,
  ManagerOptionDto,
  OrganizationHierarchyNodeDto,
} from "@repo/api";
import { ApiError } from "@repo/api";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  LoaderCircle,
  Pencil,
  Plus,
} from "lucide-react";
import { useOrganizationHierarchy } from "@/features/organization/api/use-organization";
import { OrganizationTree } from "@/features/organization/components/organization-tree";
import { usePeopleEstablishmentMutations } from "../api/use-people";
import { useManagerOptions } from "../changes/use-changes";
import { ManagerPicker } from "./workforce-pickers";
import { EmployeeIdentity, Monogram, OrgPath, initials, useWorkforceDate } from "./workforce-ui";

type EstablishmentMode = "hire" | "add-existing";
type FormState = {
  firstName: string;
  lastName: string;
  preferredName: string;
  workEmail: string;
  phone: string;
  numberMode: "Generated" | "Manual";
  employeeNumber: string;
  startDate: string;
  workDate: string;
  orgUnitId: string;
  jobTitle: string;
  location: string;
  managerMode: "None" | "Manager";
  managerEmployeeId: string;
};

type Errors = Partial<Record<keyof FormState | "form", string>>;

const today = () => new Date().toISOString().slice(0, 10);

type OrgChoice = { id: string; name: string; path: string; depth: number };
function flattenOrg(nodes: OrganizationHierarchyNodeDto[], depth = 0): OrgChoice[] {
  return nodes.flatMap((node) => [
    { id: node.unit.id, name: node.unit.name, path: node.unit.path, depth },
    ...flattenOrg(node.children, depth + 1),
  ]);
}

function OrganizationPicker({
  roots,
  value,
  onChange,
  invalid,
}: {
  roots: OrganizationHierarchyNodeDto[];
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
}) {
  const t = useTranslations("people.pickers");
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => flattenOrg(roots).find((choice) => choice.id === value), [roots, value]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" aria-invalid={invalid} className={cn("h-auto min-h-11 w-full justify-between py-2 font-normal", selected && "border-foreground/25")}>
          <span className="flex min-w-0 items-center gap-2.5">
            <Building2 className="size-4 shrink-0 text-muted-foreground" />
            {selected ? (
              <OrgPath name={selected.name} path={selected.path} className="text-start" showAncestry={false} />
            ) : (
              <span className="text-muted-foreground">{t("selectOrganization")}</span>
            )}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(32rem,calc(100vw-2rem))] p-0">
        <OrganizationTree
          roots={roots}
          selectedId={value || null}
          onSelect={(id) => {
            if (id) {
              onChange(id);
              setOpen(false);
            }
          }}
          emptyLabel={t("noValidUnit")}
        />
      </PopoverContent>
    </Popover>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t pt-8 first:border-t-0 first:pt-0">
      <h2 className="type-eyebrow text-muted-foreground">{title}</h2>
      <div className="mt-4 grid gap-5">{children}</div>
    </section>
  );
}

/** The server's own refusal in English; the screen's line in another language. */
function errorMessage(error: unknown, fallback: string, english: boolean) {
  if (!english) return fallback;
  if (error instanceof ApiError) return error.errors[0] ?? fallback;
  return error instanceof Error ? error.message : fallback;
}

export default function EstablishmentWorkspace({ mode }: { mode: EstablishmentMode }) {
  const router = useRouter();
  const t = useTranslations("people.establish");
  const english = useLocale() === "en";
  const workforceDate = useWorkforceDate();
  const states = useTranslations("people.states");
  const isHire = mode === "hire";
  const [form, setForm] = useState<FormState>({
    firstName: "", lastName: "", preferredName: "", workEmail: "", phone: "",
    numberMode: "Generated", employeeNumber: "", startDate: isHire ? today() : "",
    workDate: today(), orgUnitId: "", jobTitle: "", location: "",
    managerMode: "None", managerEmployeeId: "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [reviewing, setReviewing] = useState(false);
  const [reviewResult, setReviewResult] = useState<EstablishmentReviewDto | null>(null);
  const reviewRef = useRef<HTMLDivElement>(null);
  const manualNumberRef = useRef<HTMLInputElement>(null);
  const effectiveDate = isHire ? form.startDate : form.workDate;
  const hierarchy = useOrganizationHierarchy(effectiveDate || today(), Boolean(effectiveDate));
  const orgChoices = useMemo(() => flattenOrg(hierarchy.data?.roots ?? []), [hierarchy.data?.roots]);
  // The server searches every possible manager; the chosen one stays listed while another search runs.
  const [managerSearch, setManagerSearch] = useState("");
  const managers = useManagerOptions(effectiveDate || today(), managerSearch);
  const [pickedManager, setPickedManager] = useState<ManagerOptionDto | null>(null);
  const managerChoices = useMemo(() => {
    const found = managers.data ?? [];
    return pickedManager && !found.some((option) => option.employeeId === pickedManager.employeeId) ? [pickedManager, ...found] : found;
  }, [managers.data, pickedManager]);
  const mutations = usePeopleEstablishmentMutations();
  const mutation = isHire ? mutations.hire : mutations.addExisting;
  const selectedOrg = orgChoices.find((choice) => choice.id === form.orgUnitId);
  const selectedManager = managers.data?.find((option) => option.employeeId === form.managerEmployeeId);

  const displayName = `${form.preferredName.trim() || form.firstName.trim()} ${form.lastName.trim()}`.trim();
  const isFutureStart = isHire && Boolean(form.startDate) && form.startDate > today();
  const resultingState = isHire ? (isFutureStart ? "Scheduled" : "Active") : "Active";

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === "startDate" || key === "workDate") {
        next.orgUnitId = "";
        next.managerEmployeeId = "";
      }
      return next;
    });
    setErrors((current) => ({ ...current, [key]: undefined, form: undefined }));
    setReviewing(false);
    setReviewResult(null);
  };

  const validate = () => {
    const next: Errors = {};
    if (!form.firstName.trim()) next.firstName = t("errors.firstName");
    if (!form.lastName.trim()) next.lastName = t("errors.lastName");
    if (form.workEmail && !/^\S+@\S+\.\S+$/.test(form.workEmail)) next.workEmail = t("errors.workEmail");
    if (form.numberMode === "Manual" && !form.employeeNumber.trim()) next.employeeNumber = t("errors.employeeNumber");
    if (!form.startDate) next.startDate = isHire ? t("errors.startDate") : t("errors.employmentStart");
    if (!isHire && !form.workDate) next.workDate = t("errors.workDate");
    if (!isHire && form.startDate && form.workDate && form.workDate < form.startDate) next.workDate = t("errors.workBeforeEmployment");
    if (!isHire && form.startDate > today()) next.startDate = t("errors.futureStart");
    if (!form.orgUnitId) next.orgUnitId = t("errors.organization");
    if (!form.jobTitle.trim()) next.jobTitle = t("errors.jobTitle");
    if (form.managerMode === "Manager" && !form.managerEmployeeId) next.managerEmployeeId = t("errors.manager");
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const review = async () => {
    if (!validate()) {
      setErrors((current) => ({ ...current, form: t("errors.review") }));
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
      return;
    }
    try {
      const result = await mutations.review.mutateAsync({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        workEmail: form.workEmail.trim() || null,
        employeeNumberMode: form.numberMode,
        employeeNumber: form.numberMode === "Manual" ? form.employeeNumber.trim() : null,
      });
      setReviewResult(result);
      setReviewing(true);
      window.requestAnimationFrame(() => reviewRef.current?.focus());
    } catch (error) {
      setErrors({ form: errorMessage(error, t("failed"), english) });
    }
  };

  const submit = async () => {
    if (!validate()) return;
    try {
      const common = {
        firstName: form.firstName.trim(), lastName: form.lastName.trim(), preferredName: form.preferredName.trim() || null,
        workEmail: form.workEmail.trim() || null, phone: form.phone.trim() || null,
        employeeNumberMode: form.numberMode, employeeNumber: form.numberMode === "Manual" ? form.employeeNumber.trim() : null,
        orgUnitId: form.orgUnitId, jobTitle: form.jobTitle.trim(),
        location: form.location.trim() || null, primaryManagerEmployeeId: form.managerMode === "Manager" ? form.managerEmployeeId : null,
      };
      const result = isHire
        ? await mutations.hire.mutateAsync({ ...common, startDate: form.startDate } satisfies HireEmployeeRequest)
        : await mutations.addExisting.mutateAsync({ ...common, employmentStart: form.startDate, workDetailsEffectiveFrom: form.workDate } satisfies AddExistingEmployeeRequest);
      router.push(`/people/${result.employeeKey}?established=${mode}`);
    } catch (error) {
      setErrors({ form: errorMessage(error, t("failed"), english) });
      reviewRef.current?.focus();
    }
  };

  const numberSummary = form.numberMode === "Manual"
    ? (form.employeeNumber.trim().toUpperCase() || t("numberManual"))
    : t("numberGenerated");

  const summary = (
    <dl className="space-y-4">
      <div>
        <dt className="type-eyebrow text-muted-foreground">{t("summary.employee")}</dt>
        <dd className="mt-1.5">
          {displayName ? (
            <div className="flex items-center gap-3">
              <Monogram name={displayName} size="md" accent={resultingState === "Scheduled"} />
              <div className="min-w-0">
                <p className="type-label font-semibold">{displayName}</p>
                <p className="type-code text-xs text-muted-foreground">{numberSummary}</p>
              </div>
            </div>
          ) : <p className="type-body text-muted-foreground">{t("summary.addName")}</p>}
        </dd>
      </div>
      <div className="border-t pt-4">
        <dt className="type-eyebrow text-muted-foreground">{t("summary.employment")}</dt>
        <dd className="mt-1.5 space-y-1">
          {isHire ? (
            <div className="flex items-center gap-2">
              <StatusBadge tone={resultingState === "Scheduled" ? "info" : "success"} dot>{states(resultingState)}</StatusBadge>
              {form.startDate ? <span className="type-meta text-muted-foreground">{t("summary.starts", { date: workforceDate(form.startDate) })}</span> : null}
            </div>
          ) : (
            <>
              <p className="type-body">{t("summary.employmentStart", { date: form.startDate ? workforceDate(form.startDate) : "—" })}</p>
              <p className="type-meta text-muted-foreground">{t("summary.workEffective", { date: form.workDate ? workforceDate(form.workDate) : "—" })}</p>
            </>
          )}
        </dd>
      </div>
      <div className="border-t pt-4">
        <dt className="type-eyebrow text-muted-foreground">{t("summary.work")}</dt>
        <dd className="mt-1.5 space-y-1">
          <p className="type-body font-medium">{form.jobTitle.trim() || <span className="font-normal text-muted-foreground">{t("summary.displayTitle")}</span>}</p>
          {selectedOrg ? <OrgPath name={selectedOrg.name} path={selectedOrg.path} /> : <p className="type-meta text-muted-foreground">{t("summary.noOrganization")}</p>}
          {form.location.trim() ? <p className="type-meta text-muted-foreground">{form.location.trim()}</p> : null}
        </dd>
      </div>
      <div className="border-t pt-4">
        <dt className="type-eyebrow text-muted-foreground">{t("summary.reporting")}</dt>
        <dd className="mt-1.5">
          {form.managerMode === "None" ? (
            <p className="type-body">{t("summary.noManager")}</p>
          ) : selectedManager ? (
            <EmployeeIdentity name={selectedManager.displayName} employeeNumber={selectedManager.employeeNumber} secondary={selectedManager.jobTitle} size="sm" />
          ) : <p className="type-body text-muted-foreground">{t("summary.managerNotSelected")}</p>}
        </dd>
      </div>
    </dl>
  );

  return (
    <PageContainer width="wide" className="pb-16">
      <Link href="/people" className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ArrowLeft className="size-4" />{t("back")}
      </Link>
      <header className="mb-8 max-w-3xl">
        <p className="type-eyebrow text-muted-foreground">{isHire ? t("newHire") : t("existing")}</p>
        <h1 className="mt-1.5 type-page-title">{isHire ? t("hireTitle") : t("addTitle")}</h1>
      </header>

      <div className="grid items-start gap-12 xl:grid-cols-[minmax(0,34rem)_1fr]">
        {/* Left column: editing form or focused review */}
        <div className="min-w-0">
          {errors.form && !reviewing ? <div role="alert" className="mb-6 rounded-surface border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive">{errors.form}</div> : null}

          <form
            onSubmit={(event) => { event.preventDefault(); void review(); }}
            noValidate
            hidden={reviewing}
            className="space-y-8"
          >
            <FormSection title={t("section.employee")}>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field data-invalid={Boolean(errors.firstName)}><FieldLabel htmlFor="firstName">{t("fields.firstName")}</FieldLabel><Input id="firstName" value={form.firstName} onChange={(event) => set("firstName", event.target.value)} aria-invalid={Boolean(errors.firstName)} autoComplete="given-name" /><FieldError>{errors.firstName}</FieldError></Field>
                <Field data-invalid={Boolean(errors.lastName)}><FieldLabel htmlFor="lastName">{t("fields.lastName")}</FieldLabel><Input id="lastName" value={form.lastName} onChange={(event) => set("lastName", event.target.value)} aria-invalid={Boolean(errors.lastName)} autoComplete="family-name" /><FieldError>{errors.lastName}</FieldError></Field>
                <Field><FieldLabel htmlFor="preferredName">{t("fields.preferredName")} <span className="font-normal text-muted-foreground">{t("fields.optional")}</span></FieldLabel><Input id="preferredName" value={form.preferredName} onChange={(event) => set("preferredName", event.target.value)} /></Field>
                <Field data-invalid={Boolean(errors.workEmail)}><FieldLabel htmlFor="workEmail">{t("fields.workEmail")} <span className="font-normal text-muted-foreground">{t("fields.optional")}</span></FieldLabel><Input id="workEmail" type="email" value={form.workEmail} onChange={(event) => set("workEmail", event.target.value)} aria-invalid={Boolean(errors.workEmail)} autoComplete="email" /><FieldError>{errors.workEmail}</FieldError></Field>
              </div>

              <Field data-invalid={Boolean(errors.employeeNumber)}>
                <FieldLabel>{t("fields.employeeNumber")}</FieldLabel>
                <Segmented
                  label={t("fields.numberMode")}
                  value={form.numberMode}
                  onChange={(value) => {
                    set("numberMode", value);
                    if (value === "Manual") window.requestAnimationFrame(() => manualNumberRef.current?.focus());
                  }}
                  options={[{ value: "Generated", label: t("fields.generate") }, { value: "Manual", label: t("fields.manual") }]}
                />
                {form.numberMode === "Manual" ? (
                  <Input
                    ref={manualNumberRef}
                    value={form.employeeNumber}
                    onChange={(event) => set("employeeNumber", event.target.value)}
                    aria-label={t("fields.employeeNumber")}
                    aria-invalid={Boolean(errors.employeeNumber)}
                    placeholder={t("fields.numberPlaceholder")}
                    className="mt-3 font-mono uppercase sm:max-w-xs motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1"
                  />
                ) : null}
                <FieldError>{errors.employeeNumber}</FieldError>
              </Field>

              <Collapsible>
                <CollapsibleTrigger className="group inline-flex items-center gap-1.5 type-meta text-muted-foreground underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
                  {t("fields.additional")}
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-4">
                  <Field><FieldLabel htmlFor="phone">{t("fields.phone")} <span className="font-normal text-muted-foreground">{t("fields.optional")}</span></FieldLabel><Input id="phone" value={form.phone} onChange={(event) => set("phone", event.target.value)} autoComplete="tel" className="sm:max-w-xs" /></Field>
                </CollapsibleContent>
              </Collapsible>
            </FormSection>

            <FormSection title={t("section.employment")}>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field data-invalid={Boolean(errors.startDate)}>
                  <FieldLabel htmlFor="startDate">{isHire ? t("fields.startDate") : t("fields.employmentStart")}</FieldLabel>
                  <Input id="startDate" type="date" min={isHire ? today() : undefined} max={!isHire ? today() : undefined} value={form.startDate} onChange={(event) => set("startDate", event.target.value)} aria-invalid={Boolean(errors.startDate)} className="w-full" />
                  <FieldError>{errors.startDate}</FieldError>
                </Field>
                {!isHire ? (
                  <Field data-invalid={Boolean(errors.workDate)}>
                    <FieldLabel htmlFor="workDate">{t("fields.workFrom")}</FieldLabel>
                    <Input id="workDate" type="date" min={form.startDate || undefined} max={today()} value={form.workDate} onChange={(event) => set("workDate", event.target.value)} aria-invalid={Boolean(errors.workDate)} className="w-full" />
                    <FieldError>{errors.workDate}</FieldError>
                  </Field>
                ) : isFutureStart ? (
                  <div className="flex items-end pb-2"><StatusBadge tone="info" dot>{t("fields.scheduledStarts", { date: workforceDate(form.startDate) })}</StatusBadge></div>
                ) : null}
              </div>
            </FormSection>

            <FormSection title={isHire ? t("section.work") : t("section.currentWork")}>
              <Field data-invalid={Boolean(errors.orgUnitId)}><FieldLabel>{t("fields.organization")}</FieldLabel><OrganizationPicker roots={hierarchy.data?.roots ?? []} value={form.orgUnitId} onChange={(value) => set("orgUnitId", value)} invalid={Boolean(errors.orgUnitId)} /><FieldError>{errors.orgUnitId}</FieldError></Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field data-invalid={Boolean(errors.jobTitle)}><FieldLabel htmlFor="jobTitle">{t("fields.displayTitle")}</FieldLabel><Input id="jobTitle" value={form.jobTitle} onChange={(event) => set("jobTitle", event.target.value)} aria-invalid={Boolean(errors.jobTitle)} placeholder={t("fields.titlePlaceholder")} /><FieldError>{errors.jobTitle}</FieldError></Field>
                <Field><FieldLabel htmlFor="location">{t("fields.location")} <span className="font-normal text-muted-foreground">{t("fields.optional")}</span></FieldLabel><Input id="location" value={form.location} onChange={(event) => set("location", event.target.value)} placeholder={t("fields.locationPlaceholder")} /></Field>
              </div>
            </FormSection>

            <FormSection title={t("section.reporting")}>
              <Segmented
                label={t("fields.reporting")}
                value={form.managerMode}
                onChange={(value) => set("managerMode", value)}
                options={[{ value: "None", label: t("fields.noManager") }, { value: "Manager", label: t("fields.assignManager") }]}
              />
              {form.managerMode === "Manager" ? (
                <Field data-invalid={Boolean(errors.managerEmployeeId)} className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1">
                  <FieldLabel>{t("fields.manager")}</FieldLabel>
                  <ManagerPicker options={managerChoices} value={form.managerEmployeeId} onChange={(value) => { setPickedManager(managerChoices.find((option) => option.employeeId === value) ?? null); set("managerEmployeeId", value); }} loading={managers.isLoading} invalid={Boolean(errors.managerEmployeeId)} onQueryChange={setManagerSearch} />
                  <FieldError>{errors.managerEmployeeId}</FieldError>
                </Field>
              ) : null}
            </FormSection>

            <div className="flex items-center justify-end border-t pt-6">
              <Button type="submit" disabled={mutations.review.isLoading}>
                {mutations.review.isLoading ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : null}
                {isHire ? t("reviewHire") : t("reviewEmployee")}
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </form>

          {reviewing ? (
            <div ref={reviewRef} tabIndex={-1} aria-labelledby="review-heading" className="outline-none motion-safe:animate-in motion-safe:fade-in">
              <div className="flex items-center justify-between gap-4">
                <h2 id="review-heading" className="type-section-title">{isHire ? t("reviewHireTitle") : t("reviewEmployeeTitle")}</h2>
                <Button type="button" variant="ghost" size="sm" disabled={mutation.isLoading} onClick={() => setReviewing(false)}>
                  <Pencil className="size-3.5" /> {t("edit")}
                </Button>
              </div>

              {reviewResult?.conflict ? (
                <div role="alert" className="mt-5 rounded-surface border border-destructive/25 bg-destructive/8 p-4 text-sm">
                  <p className="font-semibold text-destructive">{t("exists")}</p>
                  <p className="mt-1 text-muted-foreground">{reviewResult.conflict.message}</p>
                  <Link className="mt-3 inline-flex items-center gap-2 rounded-control border bg-inlay px-3 py-2 font-medium underline-offset-4 hover:bg-muted" href={`/people/${reviewResult.conflict.employeeKey}`}>
                    <Monogram name={reviewResult.conflict.displayName} size="sm" /> {reviewResult.conflict.displayName} · {reviewResult.conflict.employeeNumber}
                  </Link>
                </div>
              ) : null}

              <div className="mt-5 rounded-surface border bg-card p-5">{summary}</div>

              {reviewResult?.suggestions.length ? (
                <div className="mt-5 rounded-surface border border-warning/30 bg-warning-subtle/50 p-4">
                  <p className="type-label font-semibold">{t("maybe")}</p>
                  <ul className="mt-3 space-y-2.5">
                    {reviewResult.suggestions.map((suggestion) => (
                      <li key={suggestion.employeeKey} className="flex items-center justify-between gap-3">
                        <EmployeeIdentity name={suggestion.displayName} employeeNumber={suggestion.employeeNumber} secondary={suggestion.reason} href={`/people/${suggestion.employeeKey}`} size="sm" />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {errors.form ? <p role="alert" className="mt-5 rounded-control bg-destructive/10 px-3 py-2 text-sm text-destructive">{errors.form}</p> : null}

              {!reviewResult?.conflict ? (
                <div className="mt-6 flex items-center gap-3 border-t pt-6">
                  <Button type="button" disabled={mutation.isLoading} onClick={() => void submit()}>
                    {mutation.isLoading ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <Check className="size-4" />}
                    {isHire ? t("hire") : t("add")}
                  </Button>
                  <Button type="button" variant="ghost" disabled={mutation.isLoading} onClick={() => setReviewing(false)}>{t("edit")}</Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Right column: live resulting-state summary (desktop) */}
        <aside className="top-6 hidden xl:sticky xl:block" aria-label={t("resulting")}>
          <div className="rounded-surface border bg-inlay p-5">
            <div className="flex items-center gap-2">
              <span className="grid size-7 place-items-center rounded-control-sm bg-muted text-muted-foreground">
                {displayName ? <span className="type-code text-xs font-semibold">{initials(displayName)}</span> : <Plus className="size-4" />}
              </span>
              <p className="type-eyebrow text-muted-foreground">{reviewing ? t("ready") : t("resulting")}</p>
            </div>
            <div className="mt-5">{summary}</div>
          </div>
        </aside>
      </div>
    </PageContainer>
  );
}
