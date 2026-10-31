"use client";

import { useTranslations } from "next-intl";
import { useId, useState, type ChangeEvent, type ReactNode } from "react";
import {
  ApiError,
  type PeopleEmergencyContactDto,
  type PeopleHomeAddressDto,
  type PeoplePendingAddressDto,
  type PeoplePersonalDto,
  type UpdatePersonalRequest,
} from "@repo/api";
import { Button, DatePicker, Input, Label, Skeleton, cn } from "@repo/ds";
import { Clock3, Lock, Plus, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { useRefusal } from "@/i18n/words";
import { useFormat } from "@repo/ds/lib/use-format";
import { RequestSheet } from "@/features/changes/request-sheet";
import { useChangeRights, useRequestDecisions } from "../../changes/use-changes";
import { usePeoplePersonal, useUpdatePeoplePersonal } from "../../api/use-people";
import { Monogram, useWorkforceDate } from "../workforce-ui";

type Section = "name" | "contact" | "address" | "emergency";

const MAX_CONTACTS = 3;

export interface SelfServiceRules {
  canEditPreferredName: boolean;
  canEditPhone: boolean;
}

/**
 * The Personal tab. The server shapes it for the viewer (`access`) and says whether they may change it
 * (`canEdit`); each section edits in place and saves the whole tab against the version it read.
 */
export function PersonalTab({
  employeeKey,
  displayName,
  workEmail,
  isSelf,
  selfService,
}: {
  employeeKey: string;
  displayName: string;
  workEmail: string | null;
  isSelf: boolean;
  /** The company's self-service settings; they bind the person, not HR. */
  selfService?: SelfServiceRules;
}) {
  const t = useTranslations("profile.personal");
  const personal = usePeoplePersonal(employeeKey);
  const [editing, setEditing] = useState<Section | null>(null);

  if (personal.isLoading && !personal.data) return <PersonalSkeleton />;
  if (!personal.data) {
    return (
      <div className="flex items-center justify-between gap-4 rounded-surface border border-dashed px-5 py-4 lg:mt-2">
        <p className="type-body text-muted-foreground">{t("loadFailed")}</p>
        <Button variant="ghost" size="sm" onClick={() => void personal.refetch()}>
          <RotateCcw className="size-4" aria-hidden /> {t("retry")}
        </Button>
      </div>
    );
  }

  const data = personal.data;
  const full = data.access === "Full";
  const locks = isSelf && selfService ? selfService : { canEditPreferredName: true, canEditPhone: true };
  const shared = {
    data,
    employeeKey,
    canEdit: data.canEdit,
    editing,
    setEditing,
    privateLabel: full ? (isSelf ? t("privateSelf") : t("private", { name: displayName })) : undefined,
    refetch: () => void personal.refetch(),
  };

  return (
    <div className="grid gap-5 lg:pt-2">
      <NameSection {...shared} locked={!locks.canEditPreferredName} />
      {data.access !== "Directory" || workEmail ? (
        <ContactSection {...shared} workEmail={workEmail} locked={!locks.canEditPhone} />
      ) : null}
      {full ? <AddressSection {...shared} /> : null}
      {full ? <EmergencySection {...shared} displayName={displayName} /> : null}
    </div>
  );
}

interface SectionProps {
  data: PeoplePersonalDto;
  employeeKey: string;
  canEdit: boolean;
  editing: Section | null;
  setEditing: (section: Section | null) => void;
  /** Who else sees a private section, for the person or HR. */
  privateLabel?: string;
  refetch: () => void;
}

/** What PUT needs: everything read back, with one section's change on top. */
function requestFrom(data: PeoplePersonalDto, change: Partial<UpdatePersonalRequest>): UpdatePersonalRequest {
  return {
    preferredName: data.preferredName,
    mobile: data.mobile,
    personalEmail: data.personalEmail,
    homeAddress: data.homeAddress,
    dateOfBirth: data.dateOfBirth,
    emergencyContacts: data.emergencyContacts ?? [],
    ...change,
  };
}

const blank = (value: string) => (value.trim() ? value.trim() : null);

function useSectionSave({ data, employeeKey, setEditing, refetch }: SectionProps) {
  const t = useTranslations("profile.personal");
  const refusal = useRefusal();
  const update = useUpdatePeoplePersonal(employeeKey);
  const [error, setError] = useState<string | null>(null);
  const save = async (change: Partial<UpdatePersonalRequest>) => {
    setError(null);
    try {
      await update.mutateAsync({ request: requestFrom(data, change), expectedVersion: data.version });
      toast.success(t("saved"));
      setEditing(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setError(t("conflict"));
        refetch();
        return;
      }
      setError(refusal(caught, t("failed")));
    }
  };
  return { save, saving: update.isLoading, error, clearError: () => setError(null) };
}

function SectionFrame({
  id,
  title,
  props,
  private: isPrivate = false,
  form,
  children,
}: {
  id: Section;
  title: string;
  props: SectionProps;
  private?: boolean;
  /** The section's form while it is being edited. */
  form: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations("profile.personal");
  const headingId = useId();
  const isEditing = props.editing === id;
  // One frame per section, its title, who sees it and Edit on its first line (B-225), as drawn.
  return (
    <section aria-labelledby={headingId} className="rounded-surface bg-card px-5 pt-3 pb-4">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <h2 id={headingId} className="type-section-title">{title}</h2>
        <div className="flex items-center gap-3">
          {isPrivate && props.privateLabel ? (
            <span className="inline-flex items-center gap-1.5 type-meta text-muted-foreground">
              <Lock className="size-3.5" aria-hidden /> {props.privateLabel}
            </span>
          ) : null}
          {!isEditing && props.canEdit ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={props.editing !== null}
              aria-label={t("editSection", { section: title })}
              onClick={() => props.setEditing(id)}
            >
              {t("edit")}
            </Button>
          ) : null}
        </div>
      </div>
      {isEditing ? <div className="pt-2">{form}</div> : <div className="divide-y divide-border">{children}</div>}
    </section>
  );
}

/** One fact as a row: its label on the left, its value beside it. */
function Fact({ label, children, empty }: { label: string; children?: ReactNode; empty?: boolean }) {
  const t = useTranslations("profile.personal");
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,11rem)_minmax(0,1fr)] items-baseline gap-4 py-3">
      <p className="type-meta text-muted-foreground">{label}</p>
      <div className={cn("type-body break-words", empty ? "text-muted-foreground" : "text-foreground")}>
        {empty ? t("notSet") : children}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
      {hint ? <p className="type-meta text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function FormActions({
  saving,
  error,
  disabled,
  onCancel,
}: {
  saving: boolean;
  error: string | null;
  disabled?: boolean;
  onCancel: () => void;
}) {
  const t = useTranslations("profile.personal");
  return (
    <div className="grid gap-3">
      {error ? (
        <p role="alert" className="type-meta text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving || disabled}>
          {saving ? t("saving") : t("save")}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
          {t("cancel")}
        </Button>
      </div>
    </div>
  );
}

function NameSection(props: SectionProps & { locked: boolean }) {
  const t = useTranslations("profile.personal");
  const workforceDate = useWorkforceDate();
  const { data } = props;
  const full = data.access === "Full";
  return (
    <SectionFrame id="name" title={t("name")} props={props} form={<NameForm {...props} />}>
      <Fact label={t("legalName")}>{`${data.firstName} ${data.lastName}`}</Fact>
      <Fact label={t("preferredName")} empty={!data.preferredName}>
        {data.preferredName}
      </Fact>
      {full ? (
        <Fact label={t("dateOfBirth")} empty={!data.dateOfBirth}>
          {data.dateOfBirth ? workforceDate(data.dateOfBirth, { month: "long" }) : null}
        </Fact>
      ) : null}
    </SectionFrame>
  );
}

function NameForm(props: SectionProps & { locked: boolean }) {
  const t = useTranslations("profile.personal");
  const { data } = props;
  const [preferredName, setPreferredName] = useState(data.preferredName ?? "");
  const [dateOfBirth, setDateOfBirth] = useState(data.dateOfBirth ?? "");
  const { save, saving, error } = useSectionSave(props);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save({ preferredName: props.locked ? data.preferredName : blank(preferredName), dateOfBirth: dateOfBirth || null });
      }}
    >
      <Fact label={t("legalName")}>{`${data.firstName} ${data.lastName}`}</Fact>
      <Field label={t("preferredName")} hint={props.locked ? t("lockedByCompany") : undefined}>
        {(id) => (
          <Input id={id} value={preferredName} maxLength={100} disabled={props.locked} autoFocus={!props.locked} onChange={(event) => setPreferredName(event.target.value)} />
        )}
      </Field>
      <Field label={t("dateOfBirth")}>
        {(id) => (
          <DatePicker id={id} min="1900-01-01" max={today} value={dateOfBirth} onChange={setDateOfBirth} captionLayout="dropdown" />
        )}
      </Field>
      <FormActions saving={saving} error={error} onCancel={() => props.setEditing(null)} />
    </form>
  );
}

function ContactSection(props: SectionProps & { workEmail: string | null; locked: boolean }) {
  const t = useTranslations("profile.personal");
  const { data, workEmail } = props;
  const full = data.access === "Full";
  return (
    <SectionFrame id="contact" title={t("contact")} props={props} form={<ContactForm {...props} />}>
      {data.access !== "Directory" ? (
        <Fact label={t("mobile")} empty={!data.mobile}>
          {data.mobile}
        </Fact>
      ) : null}
      {full ? (
        <Fact label={t("personalEmail")} empty={!data.personalEmail}>
          {data.personalEmail}
        </Fact>
      ) : null}
      {workEmail ? (
        <Fact label={t("workEmail")}>
          <span className="text-muted-foreground">{workEmail}</span>
        </Fact>
      ) : null}
    </SectionFrame>
  );
}

function ContactForm(props: SectionProps & { workEmail: string | null; locked: boolean }) {
  const t = useTranslations("profile.personal");
  const { data } = props;
  const [mobile, setMobile] = useState(data.mobile ?? "");
  const [personalEmail, setPersonalEmail] = useState(data.personalEmail ?? "");
  const { save, saving, error } = useSectionSave(props);
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save({ mobile: props.locked ? data.mobile : blank(mobile), personalEmail: blank(personalEmail) });
      }}
    >
      <Field label={t("mobile")} hint={props.locked ? t("lockedByCompany") : undefined}>
        {(id) => (
          <Input id={id} type="tel" inputMode="tel" autoComplete="tel" value={mobile} maxLength={50} disabled={props.locked} autoFocus={!props.locked} onChange={(event) => setMobile(event.target.value)} />
        )}
      </Field>
      <Field label={t("personalEmail")}>
        {(id) => (
          <Input id={id} type="email" inputMode="email" autoComplete="email" value={personalEmail} maxLength={254} autoFocus={props.locked} onChange={(event) => setPersonalEmail(event.target.value)} />
        )}
      </Field>
      {props.workEmail ? (
        <Fact label={t("workEmail")}>
          <span className="text-muted-foreground">{props.workEmail}</span>
        </Fact>
      ) : null}
      <FormActions saving={saving} error={error} onCancel={() => props.setEditing(null)} />
    </form>
  );
}

function addressLines(address: PeopleHomeAddressDto | null): string[] {
  if (!address) return [];
  const place = [address.postalCode, address.city].filter(Boolean).join(" ");
  return [address.street, place, address.country].filter((line): line is string => Boolean(line));
}

function AddressSection(props: SectionProps) {
  const t = useTranslations("profile.personal");
  const lines = addressLines(props.data.homeAddress);
  return (
    <SectionFrame id="address" title={t("address")} props={props} private form={<AddressForm {...props} />}>
      {props.data.pendingHomeAddress ? <PendingAddress pending={props.data.pendingHomeAddress} /> : null}
      <Fact label={t("current")} empty={lines.length === 0}>
        <address className="not-italic">{lines.join(", ")}</address>
      </Fact>
    </SectionFrame>
  );
}

/** A new address waiting for HR (D-16): the person can withdraw it; HR opens it to answer. */
function PendingAddress({ pending }: { pending: PeoplePendingAddressDto }) {
  const t = useTranslations("changes.pending");
  const format = useFormat();
  const refusal = useRefusal();
  const rights = useChangeRights();
  const { withdraw } = useRequestDecisions();
  const [opened, setOpened] = useState(false);
  return (
    <div className="my-2 flex items-start gap-3 rounded-control bg-inlay px-3.5 py-3 animate-in fade-in-0 duration-300">
      <Clock3 aria-hidden className="mt-0.5 size-4 shrink-0 text-primary-ink" />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="type-label font-semibold">{t("title")}</p>
        <p className="truncate type-meta text-muted-foreground">
          {[addressLines(pending.address).join(", "), t("sent", { date: format.date(pending.requestedAt) })].filter(Boolean).join(" · ")}
        </p>
      </div>
      {rights.approve ? (
        <Button type="button" size="sm" variant="outline" onClick={() => setOpened(true)}>{t("open")}</Button>
      ) : (
        <Button type="button" size="sm" variant="ghost" disabled={withdraw.isLoading}
          onClick={() => void withdraw.mutateAsync(pending.requestId).then(() => toast.success(t("withdrawn")), (caught) => toast.error(refusal(caught, t("withdraw"))))}>
          {t("withdraw")}
        </Button>
      )}
      {rights.approve ? <RequestSheet id={opened ? pending.requestId : null} onClose={() => setOpened(false)} /> : null}
    </div>
  );
}

function AddressForm(props: SectionProps) {
  const t = useTranslations("profile.personal");
  const current = props.data.homeAddress;
  const [draft, setDraft] = useState({
    street: current?.street ?? "",
    city: current?.city ?? "",
    postalCode: current?.postalCode ?? "",
    country: current?.country ?? "",
  });
  const { save, saving, error } = useSectionSave(props);
  const set = (key: keyof typeof draft) => (event: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, [key]: event.target.value });
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const address = { street: blank(draft.street), city: blank(draft.city), postalCode: blank(draft.postalCode), country: blank(draft.country) };
        void save({ homeAddress: Object.values(address).some(Boolean) ? address : null });
      }}
    >
      <Field label={t("street")}>{(id) => <Input id={id} value={draft.street} maxLength={200} autoComplete="street-address" autoFocus onChange={set("street")} />}</Field>
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
        <Field label={t("city")}>{(id) => <Input id={id} value={draft.city} maxLength={100} autoComplete="address-level2" onChange={set("city")} />}</Field>
        <Field label={t("postalCode")}>{(id) => <Input id={id} value={draft.postalCode} maxLength={20} autoComplete="postal-code" onChange={set("postalCode")} />}</Field>
      </div>
      <Field label={t("country")}>{(id) => <Input id={id} value={draft.country} maxLength={100} autoComplete="country-name" onChange={set("country")} />}</Field>
      <FormActions saving={saving} error={error} onCancel={() => props.setEditing(null)} />
    </form>
  );
}

function EmergencySection(props: SectionProps & { displayName: string }) {
  const t = useTranslations("profile.personal");
  const contacts = props.data.emergencyContacts ?? [];
  return (
    <SectionFrame id="emergency" title={t("emergency")} props={props} private form={<EmergencyForm {...props} />}>
      {contacts.length > 0 ? (
        <ul className="divide-y divide-border">
          {contacts.map((contact, index) => (
            <li key={`${contact.name}-${index}`} className="flex min-w-0 items-start gap-3 py-3">
              <Monogram name={contact.name} size="md" />
              <div className="min-w-0">
                <p className="truncate type-label text-foreground">{contact.name}</p>
                {contact.relationship ? <p className="truncate type-meta text-muted-foreground">{contact.relationship}</p> : null}
                <p className="mt-0.5 type-body text-foreground tabular-nums">{contact.phone}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-3 type-body text-muted-foreground">{t("noContacts")}</p>
      )}
    </SectionFrame>
  );
}

function EmergencyForm(props: SectionProps) {
  const t = useTranslations("profile.personal");
  const [rows, setRows] = useState<PeopleEmergencyContactDto[]>(
    props.data.emergencyContacts?.length ? props.data.emergencyContacts : [{ name: "", relationship: "", phone: "" }]
  );
  const { save, saving, error } = useSectionSave(props);
  const change = (index: number, key: keyof PeopleEmergencyContactDto, value: string) =>
    setRows(rows.map((row, at) => (at === index ? { ...row, [key]: value } : row)));
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const contacts = rows
          .map((row) => ({ name: row.name.trim(), relationship: blank(row.relationship ?? ""), phone: row.phone.trim() }))
          .filter((row) => row.name || row.relationship || row.phone);
        void save({ emergencyContacts: contacts });
      }}
    >
      {rows.map((row, index) => (
        <fieldset key={index} className="grid gap-3 border-b pb-4 last-of-type:border-b-0">
          <legend className="mb-2 flex w-full items-center justify-between type-label text-muted-foreground">
            {t("contactNumber", { number: index + 1 })}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={t("removeContact", { name: row.name || t("contactNumber", { number: index + 1 }) })}
              onClick={() => setRows(rows.filter((_, at) => at !== index))}
            >
              <X className="size-4" aria-hidden />
            </Button>
          </legend>
          <Field label={t("contactName")}>{(id) => <Input id={id} value={row.name} maxLength={100} autoFocus={index === 0} onChange={(event) => change(index, "name", event.target.value)} />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("relationship")}>{(id) => <Input id={id} value={row.relationship ?? ""} maxLength={50} onChange={(event) => change(index, "relationship", event.target.value)} />}</Field>
            <Field label={t("phone")}>{(id) => <Input id={id} type="tel" inputMode="tel" value={row.phone} maxLength={50} onChange={(event) => change(index, "phone", event.target.value)} />}</Field>
          </div>
        </fieldset>
      ))}
      {rows.length < MAX_CONTACTS ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="justify-self-start"
          onClick={() => setRows([...rows, { name: "", relationship: "", phone: "" }])}
        >
          <Plus className="size-4" aria-hidden /> {t("addContact")}
        </Button>
      ) : null}
      <FormActions saving={saving} error={error} onCancel={() => props.setEditing(null)} />
    </form>
  );
}

function PersonalSkeleton() {
  return (
    <div className="grid gap-5 lg:pt-2">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="space-y-3 rounded-surface bg-card p-5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-2/3" />
        </div>
      ))}
    </div>
  );
}
