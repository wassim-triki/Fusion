"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import type {
  EmployeeFieldArea,
  EmployeeFieldDefinitionDto,
  EmployeeFieldEditor,
  EmployeeFieldGalleryItemDto,
  EmployeeFieldType,
  FusionSettingsSection,
} from "@repo/api";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  cn,
} from "@repo/ds";
import { PageError, Said, Section, SettingsPage } from "@repo/ds/shell";
import { Check, Eye, LockKeyhole, MoreHorizontal, Plus, Save, X } from "lucide-react";
import { usePeople, usePeopleFields, usePeopleProfile } from "@/features/people/api/use-people";
import { Monogram } from "@/features/people/components/workforce-ui";
import { useEmployeeFields, useUpdateEmployeeFields } from "@/features/settings/api/use-tenant-settings";
import { useCoreSettingsLabel } from "@/features/settings/core-settings";
import { useRefusal } from "@/i18n/words";

type Audience = "Everyone" | "ManagersAndHr" | "YouAndHr" | "Hr" | "Hidden";

const AREAS: EmployeeFieldArea[] = ["About", "Personal", "Job"];
function audienceOf(field: EmployeeFieldDefinitionDto): Audience {
  if (!field.visible) return "Hidden";
  if (field.visibleToEmployee && field.visibleToManager) return "Everyone";
  if (field.visibleToManager) return "ManagersAndHr";
  if (field.visibleToEmployee) return "YouAndHr";
  return "Hr";
}

function withAudience(field: EmployeeFieldDefinitionDto, audience: Audience): EmployeeFieldDefinitionDto {
  return {
    ...field,
    visible: audience !== "Hidden",
    visibleToEmployee: audience === "Everyone" || audience === "YouAndHr",
    visibleToManager: audience === "Everyone" || audience === "ManagersAndHr",
  };
}

/** Settings › Company › Fields, ported from the accepted explorer's grouped list, gallery and real-person preview. */
export function EmployeeFieldsSettings({ section }: { section: FusionSettingsSection }) {
  const t = useTranslations("settings.employeeFields");
  const title = useCoreSettingsLabel()(section.id);
  const refusal = useRefusal();
  const editable = section.access === "manage";
  const query = useEmployeeFields();
  const update = useUpdateEmployeeFields();
  const people = usePeople({ page: 1, pageSize: 50, sort: "Name", direction: "Asc" });
  const [draft, setDraft] = useState<EmployeeFieldDefinitionDto[] | null>(null);
  const [previewKey, setPreviewKey] = useState("");
  const [editing, setEditing] = useState<EmployeeFieldDefinitionDto | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saved = query.data?.fields;
  const fields = draft ?? saved ?? [];
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved);

  useEffect(() => {
    if (previewKey || !people.data?.items.length) return;
    setPreviewKey(people.data.items[0]!.employeeKey);
  }, [people.data, previewKey]);

  const profile = usePeopleProfile(previewKey);
  const profileFields = usePeopleFields(previewKey, Boolean(previewKey));

  const change = useCallback(
    (key: string, next: (field: EmployeeFieldDefinitionDto) => EmployeeFieldDefinitionDto) => {
      setDraft((current) => (current ?? saved ?? []).map((field) => (field.key === key ? next(field) : field)));
      setError(null);
    },
    [saved],
  );

  const addGallery = (item: EmployeeFieldGalleryItemDto) => {
    if (fields.some((field) => field.galleryKey === item.key)) return;
    const next: EmployeeFieldDefinitionDto = {
      id: null,
      key: item.key,
      label: item.label,
      area: item.area,
      type: item.type,
      changedBy: item.changedBy,
      visible: true,
      visibleToEmployee: item.area === "About",
      visibleToManager: true,
      required: false,
      builtIn: false,
      sortOrder: Math.max(0, ...fields.filter((field) => field.area === item.area).map((field) => field.sortOrder)) + 10,
      sourceKey: null,
      galleryKey: item.key,
    };
    setDraft([...(draft ?? saved ?? []), next]);
    setError(null);
  };

  const remove = (key: string) => {
    setDraft((current) => (current ?? saved ?? []).filter((field) => field.key !== key));
    setEditing(null);
  };

  const save = async () => {
    if (!dirty) return;
    setError(null);
    try {
      await update.mutateAsync({
        expectedVersion: query.data?.version ?? null,
        input: { fields: fields.map(({ builtIn: _builtIn, sourceKey: _sourceKey, ...field }) => field) },
      });
      setDraft(null);
    } catch (caught) {
      setError(refusal(caught, t("notSaved")));
    }
  };

  if (query.error && !query.data) {
    return <SettingsPage title={title} studio><PageError title={t("didNotLoad")} onRetry={() => void query.refetch()} /></SettingsPage>;
  }

  return (
    <SettingsPage
      title={title}
      lastChange={section.lastChange}
      setUpAt={section.setUpAt}
      viewOnly={!editable}
      studio
      loading={!saved}
      aside={editable ? (
        <>
          <Button variant="outline" onClick={() => setEditing("new")}><Plus className="size-4" aria-hidden />{t("newField")}</Button>
          <Button variant="ghost" disabled={!dirty || update.isLoading} onClick={() => { setDraft(null); setError(null); }}>{t("discard")}</Button>
          <Button disabled={!dirty || update.isLoading} onClick={() => void save()}><Save className="size-4" aria-hidden />{update.isLoading ? t("saving") : t("save")}</Button>
        </>
      ) : undefined}
    >
      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-7">
          {AREAS.map((area) => (
            <FieldGroup
              key={area}
              area={area}
              fields={fields.filter((field) => field.area === area).sort((a, b) => a.sortOrder - b.sortOrder)}
              editable={editable}
              onAudience={(key, audience) => change(key, (field) => withAudience(field, audience))}
              onEdit={setEditing}
            />
          ))}
          <Gallery items={query.data?.gallery ?? []} added={new Set(fields.map((field) => field.galleryKey).filter(Boolean))} editable={editable} onAdd={addGallery} />
          <RecordsToComplete records={query.data?.recordsToComplete ?? []} />
          {error ? <p role="alert" className="type-body text-destructive">{error}</p> : null}
        </div>
        <Preview
          people={people.data?.items ?? []}
          employeeKey={previewKey}
          onEmployee={setPreviewKey}
          name={profile.data?.identity.displayName ?? ""}
          photoUrl={profile.data?.identity.photoUrl}
          about={profile.data?.identity.about ?? null}
          fields={fields.filter((field) => field.area === "About" && field.sourceKey === null)}
          savedFields={profileFields.data ?? []}
        />
      </div>
      <FieldDialog
        field={editing}
        onClose={() => setEditing(null)}
        onSave={(field) => {
          if (editing === "new") setDraft([...(draft ?? saved ?? []), field]);
          else change(field.key, () => field);
          setEditing(null);
        }}
        onRemove={remove}
      />
    </SettingsPage>
  );
}

function FieldGroup({ area, fields, editable, onAudience, onEdit }: {
  area: EmployeeFieldArea;
  fields: EmployeeFieldDefinitionDto[];
  editable: boolean;
  onAudience: (key: string, audience: Audience) => void;
  onEdit: (field: EmployeeFieldDefinitionDto) => void;
}) {
  const t = useTranslations("settings.employeeFields");
  if (area === "Job") return <JobGroup />;
  return (
    <Section title={t(`areas.${area}`)} flush>
      <div className="grid min-h-9 grid-cols-[minmax(0,1fr)_150px_128px_36px] items-center gap-3 border-b px-5 type-meta text-muted-foreground">
        <span /><span>{t("seenBy")}</span><span>{t("changedBy")}</span><span />
      </div>
      <div className="divide-y divide-border">
        {fields.map((field) => {
          return (
            <div key={field.key} className="grid min-h-[52px] grid-cols-[minmax(0,1fr)_150px_128px_36px] items-center gap-3 px-5">
              <div className="min-w-0">
                <p className="truncate type-label text-foreground">{field.label}{field.required ? <span className="ms-1 text-primary-ink">*</span> : null}</p>
                <p className="type-meta text-muted-foreground">{t(`types.${field.type}`)}</p>
              </div>
              {editable ? (
                <AudienceSelect value={audienceOf(field)} onChange={(value) => onAudience(field.key, value)} label={field.label} />
              ) : (
                <span className="inline-flex items-center gap-1.5 type-meta text-muted-foreground"><Eye className="size-3.5" aria-hidden />{t(`audience.${audienceOf(field)}`)}</span>
              )}
              <span className="type-meta text-muted-foreground">
                {t(`editors.${field.changedBy}`)}
              </span>
              {editable ? (
                <Button variant="ghost" size="icon-sm" aria-label={t("more", { field: field.label })} onClick={() => onEdit(field)}><MoreHorizontal className="size-4" aria-hidden /></Button>
              ) : <span />}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/** Job facts are one locked row: they change only through Make a change, with a date (D-18). */
function JobGroup() {
  const t = useTranslations("settings.employeeFields");
  return (
    <Section title={t("areas.Job")} flush>
      <div className="grid min-h-[52px] grid-cols-[minmax(0,1fr)_150px_128px_36px] items-center gap-3 px-5">
        <div className="min-w-0">
          <p className="flex items-center gap-2 type-label text-foreground">{t("jobRow")}<LockKeyhole className="size-3.5 text-muted-foreground" aria-hidden /></p>
          <p className="type-meta text-muted-foreground">{t("jobRowMeta")}</p>
        </div>
        <span className="inline-flex items-center gap-1.5 type-meta text-muted-foreground"><Eye className="size-3.5" aria-hidden />{t("audience.Everyone")}</span>
        <span className="type-meta text-muted-foreground">{t("jobEditors")}</span>
        <span />
      </div>
    </Section>
  );
}

function AudienceSelect({ value, onChange, label }: { value: Audience; onChange: (value: Audience) => void; label: string }) {
  const t = useTranslations("settings.employeeFields");
  return (
    <Select value={value} onValueChange={(next) => onChange(next as Audience)}>
      <SelectTrigger className="h-8 w-[146px]" aria-label={t("seenByField", { field: label })}><Eye className="size-3.5" aria-hidden /><SelectValue /></SelectTrigger>
      <SelectContent>
        {(["Everyone", "ManagersAndHr", "YouAndHr", "Hr", "Hidden"] as Audience[]).map((audience) => <SelectItem key={audience} value={audience}>{t(`audience.${audience}`)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function Gallery({ items, added, editable, onAdd }: { items: EmployeeFieldGalleryItemDto[]; added: Set<string | null>; editable: boolean; onAdd: (item: EmployeeFieldGalleryItemDto) => void }) {
  const t = useTranslations("settings.employeeFields");
  return (
    <Section title={t("readyMade")} meta={t("readyMadeMeta")} flush>
      <div className="grid px-5 sm:grid-cols-2 sm:gap-x-6">
        {items.map((item, index) => {
          const isAdded = added.has(item.key);
          return (
            <div key={item.key} className={cn("flex min-h-14 items-center gap-3 border-t py-2.5", index < 2 && "sm:border-t-0", index === 0 && "border-t-0")}>
              <div className="min-w-0 flex-1"><p className="type-label text-foreground">{item.label}</p><p className="truncate type-meta text-muted-foreground">{item.description}</p></div>
              {isAdded ? <span className="inline-flex items-center gap-1 type-meta text-muted-foreground"><Check className="size-3.5 text-success" aria-hidden />{t("added")}</span>
                : editable ? <Button variant="outline" size="sm" onClick={() => onAdd(item)}><Plus className="size-3.5" aria-hidden />{t("add")}</Button> : null}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function RecordsToComplete({ records }: { records: { employeeKey: string; displayName: string; jobTitle: string | null; missing: string[] }[] }) {
  const t = useTranslations("settings.employeeFields");
  return (
    <Section title={t("recordsToComplete")} meta={t("peopleCount", { count: records.length })} flush>
      {records.length ? <div className="divide-y divide-border">
        {records.slice(0, 8).map((person) => (
          <Link key={person.employeeKey} href={`/people/${person.employeeKey}`} className="flex min-h-14 items-center gap-3 px-5 hover:bg-inlay">
            <Monogram name={person.displayName} size="sm" />
            <div className="min-w-0 flex-1"><p className="truncate type-label">{person.displayName}</p><p className="truncate type-meta text-muted-foreground">{person.jobTitle}</p></div>
            <span className="max-w-[45%] truncate type-meta text-muted-foreground">{person.missing.join(", ")}</span>
          </Link>
        ))}
      </div> : <p className="px-5 py-4 type-body text-muted-foreground">{t("recordsComplete")}</p>}
    </Section>
  );
}

function Preview({ people, employeeKey, onEmployee, name, photoUrl, about, fields, savedFields }: {
  people: { employeeKey: string; displayName: string }[];
  employeeKey: string;
  onEmployee: (key: string) => void;
  name: string;
  photoUrl?: string | null;
  about: string | null;
  fields: EmployeeFieldDefinitionDto[];
  savedFields: { key: string; value: unknown }[];
}) {
  const t = useTranslations("settings.employeeFields");
  const value = (field: EmployeeFieldDefinitionDto): string[] => {
    const stored = savedFields.find((candidate) => candidate.key === field.key)?.value;
    if (Array.isArray(stored)) return stored.map(String);
    if (typeof stored === "string" && stored.trim()) return [stored];
    return [];
  };
  return (
    <aside className="grid gap-3 xl:sticky xl:top-5">
      <div className="flex items-center justify-between gap-3">
        <p className="type-meta text-muted-foreground">{t("onPersonPage")}</p>
        <Select value={employeeKey} onValueChange={onEmployee}>
          <SelectTrigger className="h-8 max-w-56"><SelectValue placeholder={t("choosePerson")} /></SelectTrigger>
          <SelectContent>{people.map((person) => <SelectItem key={person.employeeKey} value={person.employeeKey}>{person.displayName}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <Section title={name ? t("aboutName", { name }) : t("areas.About")}>
        {name ? <div className="mb-4 flex items-center gap-3"><Monogram name={name} photoUrl={photoUrl} size="md" /><p className="type-label">{name}</p></div> : null}
        {about ? <Said className="mb-5">{about}</Said> : null}
        <div className="space-y-4">
          {fields.map((field) => {
            const values = value(field);
            return <div key={field.key} className={cn("grid gap-2", field.id === null && "animate-in fade-in slide-in-from-bottom-1 duration-300")}><p className="type-meta text-muted-foreground">{field.label}</p><div className="flex flex-wrap gap-2">
              {values.length ? values.map((item) => <span key={item} className="rounded-control border border-border bg-inlay px-2.5 py-1 type-meta-strong">{item}</span>)
                : <span className="type-meta text-muted-foreground">{t("notFilled")}</span>}
            </div></div>;
          })}
        </div>
      </Section>
    </aside>
  );
}

function FieldDialog({ field, onClose, onSave, onRemove }: { field: EmployeeFieldDefinitionDto | "new" | null; onClose: () => void; onSave: (field: EmployeeFieldDefinitionDto) => void; onRemove: (key: string) => void }) {
  const t = useTranslations("settings.employeeFields");
  const original = field && field !== "new" ? field : null;
  // A built-in field keeps its name, place and editor; only whether it is required changes here.
  const fixed = Boolean(original?.builtIn);
  const [label, setLabel] = useState("");
  const [area, setArea] = useState<EmployeeFieldArea>("About");
  const [type, setType] = useState<EmployeeFieldType>("Text");
  const [editor, setEditor] = useState<EmployeeFieldEditor>("Employee");
  const [required, setRequired] = useState(false);
  useEffect(() => {
    setLabel(original?.label ?? ""); setArea(original?.area ?? "About"); setType(original?.type ?? "Text");
    setEditor(original?.changedBy ?? "Employee"); setRequired(original?.required ?? false);
  }, [field, original]);
  const submit = () => {
    const clean = label.trim();
    if (!clean) return;
    onSave(original ? { ...original, label: clean, area, type, changedBy: editor, required } : {
      id: null, key: `custom-${globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Date.now()}`, label: clean, area, type,
      changedBy: editor, visible: true, visibleToEmployee: true, visibleToManager: true, required, builtIn: false,
      sortOrder: 500, sourceKey: null, galleryKey: null,
    });
  };
  return (
    <Dialog open={Boolean(field)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader><DialogTitle>{original ? t("editField") : t("newField")}</DialogTitle></DialogHeader>
        <div className="grid gap-4">
          <label className="grid gap-1.5 type-label">{t("field")}<Input value={label} maxLength={100} autoFocus disabled={fixed} onChange={(event) => setLabel(event.target.value)} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1.5 type-label">{t("showsIn")}<Select value={area} disabled={fixed} onValueChange={(next) => setArea(next as EmployeeFieldArea)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
              <SelectItem value="About">{t("areas.About")}</SelectItem><SelectItem value="Personal">{t("areas.Personal")}</SelectItem>
            </SelectContent></Select></label>
            <label className="grid gap-1.5 type-label">{t("fieldType")}<Select value={type} disabled={Boolean(original)} onValueChange={(next) => setType(next as EmployeeFieldType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
              {(["Text", "Tags", "Date", "Email", "Phone", "Address", "Section"] as EmployeeFieldType[]).map((value) => <SelectItem key={value} value={value}>{t(`types.${value}`)}</SelectItem>)}
            </SelectContent></Select></label>
          </div>
          <label className="grid gap-1.5 type-label">{t("changedBy")}<Select value={editor} disabled={fixed} onValueChange={(next) => setEditor(next as EmployeeFieldEditor)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
            {([...(fixed && editor !== "Employee" && editor !== "Hr" ? [editor] : []), "Employee", "Hr"] as EmployeeFieldEditor[]).map((value) => <SelectItem key={value} value={value}>{t(`editors.${value}`)}</SelectItem>)}
          </SelectContent></Select></label>
          <label className="flex min-h-10 items-center justify-between gap-4 rounded-control border px-3 type-label">{t("required")}<Switch checked={required} onCheckedChange={setRequired} /></label>
        </div>
        <DialogFooter className="items-center sm:justify-between">
          {original && !original.builtIn ? <Button variant="ghost" className="text-destructive" onClick={() => onRemove(original.key)}><X className="size-4" aria-hidden />{t("remove")}</Button> : <span />}
          <div className="flex gap-2"><Button variant="ghost" onClick={onClose}>{t("cancel")}</Button><Button disabled={!label.trim()} onClick={submit}>{t("apply")}</Button></div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
