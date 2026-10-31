"use client";

import { useOrganizationEvents } from "./organization-words";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DatePicker,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Textarea,
  cn,
} from "@repo/ds";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Check,
  ChevronsUpDown,
  Plus,
  Search,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  translateOrganizationError,
  type OrganizationChangeDto,
  type OrganizationalUnitTypeDto,
  type OrganizationUnitStateDto,
} from "@repo/api";
import {
  useOrganizationHierarchy,
  type OrganizationMutations,
} from "../api/use-organization";
import type { OrganizationHierarchyModel } from "../model/hierarchy";
import {
  buildOrganizationHierarchy,
  deepestBlockingUnit,
  isInvalidMoveTarget,
} from "../model/hierarchy";
import {
  organizationCodeSuggestion,
  type MoveProposal,
  type UnitFormMode,
} from "../model/workspace-state";

function FormError({ error }: { error: unknown }) {
  const t = useTranslations("organization");
  const english = useLocale() === "en";
  if (!error) return null;
  const problem = translateOrganizationError(error);
  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>
        {problem.kind === "concurrency"
          ? t("problem.changed")
          : t("problem.failed")}
      </AlertTitle>
      <AlertDescription>{english ? problem.message : t(`problem.${problem.kind}`)}</AlertDescription>
    </Alert>
  );
}

function EffectiveDateField({
  value,
  onChange,
  today,
  allowPast = false,
}: {
  value: string;
  onChange: (value: string) => void;
  today: string;
  allowPast?: boolean;
}) {
  const t = useTranslations("organization");
  return (
    <div className="space-y-1.5">
      <Label htmlFor="organization-effective-date">{t("effectiveDate.label")}</Label>
      <DatePicker
        id="organization-effective-date"
        value={value}
        min={allowPast ? undefined : today}
        onChange={onChange}
      />
      <p className="text-xs text-muted-foreground">
        {value === today
          ? t("effectiveDate.today")
          : value > today
            ? t("effectiveDate.future")
            : t("effectiveDate.past")}
      </p>
    </div>
  );
}

function PickerTrigger({
  id,
  open,
  placeholder,
  children,
}: {
  id?: string;
  open: boolean;
  placeholder: string;
  children?: ReactNode;
}) {
  return (
    <PopoverTrigger asChild>
      <Button
        type="button"
        variant="outline"
        role="combobox"
        aria-expanded={open}
        id={id}
        className="w-full justify-between font-normal"
      >
        {children ?? (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
        <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>
    </PopoverTrigger>
  );
}

function TypePicker({
  value,
  types,
  onChange,
  id,
}: {
  value: string;
  types: OrganizationalUnitTypeDto[];
  onChange: (value: string) => void;
  id?: string;
}) {
  const t = useTranslations("organization");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const matches = types.filter((type) =>
    type.displayName
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase())
  );
  const selected = types.find((type) => type.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PickerTrigger id={id} open={open} placeholder={t("typePicker.placeholder")}>
        {selected ? <span className="truncate">{selected.displayName}</span> : undefined}
      </PickerTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <div className="relative border-b">
          <Search className="pointer-events-none absolute inset-s-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            aria-label={t("typePicker.search")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("typePicker.find")}
            className="border-0 ps-9 shadow-none focus-visible:ring-0"
          />
        </div>
        <div role="listbox" aria-label={t("typePicker.list")} className="max-h-56 overflow-y-auto p-1">
          {matches.length ? (
            matches.map((type) => (
              <button
                key={type.id}
                type="button"
                role="option"
                aria-selected={type.id === value}
                onClick={() => {
                  onChange(type.id);
                  setQuery("");
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-start text-sm outline-none hover:bg-muted focus-visible:bg-muted",
                  type.id === value && "bg-primary/[0.07]"
                )}
              >
                <Check className={cn("h-4 w-4", type.id === value ? "opacity-100" : "opacity-0")} />
                <span className="font-medium">{type.displayName}</span>
                <span className="ms-auto text-xs text-muted-foreground">
                  {type.isBuiltIn ? t("typePicker.builtIn") : t("typePicker.custom")}
                </span>
              </button>
            ))
          ) : (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">
              {t("typePicker.none")}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function HierarchyPicker({
  value,
  model,
  sourceId,
  label,
  onChange,
  id,
}: {
  value: string | null;
  model: OrganizationHierarchyModel;
  sourceId?: string;
  label: string;
  onChange: (value: string) => void;
  id?: string;
}) {
  const t = useTranslations("organization");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLocaleLowerCase();
  const candidates = model.units.filter(
    (unit) =>
      (!sourceId || !isInvalidMoveTarget(model, sourceId, unit.id)) &&
      (!normalized ||
        `${unit.name} ${unit.code} ${unit.typeName}`
          .toLocaleLowerCase()
          .includes(normalized))
  );
  const selected = value ? model.byId.get(value) : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PickerTrigger id={id} open={open} placeholder={t("hierarchyPicker.select", { label: label.toLocaleLowerCase() })}>
        {selected ? (
          <span className="truncate">
            {selected.name}{" "}
            <span className="font-mono text-xs text-muted-foreground">{selected.code}</span>
          </span>
        ) : undefined}
      </PickerTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <div className="relative border-b">
          <Search className="pointer-events-none absolute inset-s-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            aria-label={t("hierarchyPicker.search", { label: label.toLocaleLowerCase() })}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("hierarchyPicker.find")}
            className="border-0 ps-9 shadow-none focus-visible:ring-0"
          />
        </div>
        <div role="listbox" aria-label={label} className="max-h-56 overflow-y-auto p-1">
          {candidates.length ? (
            candidates.map((unit) => (
              <button
                key={unit.id}
                type="button"
                role="option"
                aria-selected={unit.id === value}
                onClick={() => {
                  onChange(unit.id);
                  setQuery("");
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-start gap-2 rounded-control px-2 py-1.5 text-start outline-none hover:bg-muted focus-visible:bg-muted",
                  unit.id === value && "bg-primary/[0.07]"
                )}
              >
                <Check className={cn("mt-0.5 h-4 w-4 shrink-0", unit.id === value ? "opacity-100" : "opacity-0")} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{unit.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {unit.typeName} · {unit.code}
                  </span>
                </span>
              </button>
            ))
          ) : (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">
              {t("hierarchyPicker.none")}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function RootEstablishment({
  canManage,
  today,
  tenantName,
  mutations,
  onCreated,
}: {
  canManage: boolean;
  today: string;
  tenantName: string | null;
  mutations: OrganizationMutations;
  onCreated: (id: string, effectiveDate: string) => void;
}) {
  const t = useTranslations("organization");
  const suggestedName = tenantName?.trim() ?? "";
  const [name, setName] = useState(suggestedName);
  const nameTouched = useRef(false);
  const [code, setCode] = useState(() => organizationCodeSuggestion(suggestedName));
  const codeTouched = useRef(false);
  const [effectiveDate, setEffectiveDate] = useState(today);

  useEffect(() => {
    if (!suggestedName || nameTouched.current) return;
    setName(suggestedName);
    if (!codeTouched.current)
      setCode(organizationCodeSuggestion(suggestedName));
  }, [suggestedName]);

  if (!canManage) {
    return (
      <div className="mx-auto flex min-h-[420px] max-w-xl flex-col justify-center px-6">
        <div className="mb-5 grid h-11 w-11 place-items-center rounded-control bg-muted text-muted-foreground">
          <CalendarClock className="h-5 w-5" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight">
          {t("root.notEstablished")}
        </h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          {t("root.notEstablishedDescription")}
        </p>
      </div>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const created = await mutations.createRoot.mutateAsync({
        name: name.trim(),
        code: code.trim(),
        effectiveDate,
      });
      toast.success(
        effectiveDate === today
          ? t("root.created")
          : t("root.scheduled"),
        {
          description:
            effectiveDate === today
              ? t("root.createdDescription")
              : t("root.scheduledDescription", { date: effectiveDate }),
        }
      );
      onCreated(created.id, effectiveDate);
    } catch {
      /* mutation owns the error state */
    }
  }

  return (
    <div className="mx-auto grid min-h-[520px] max-w-4xl grid-cols-[minmax(0,1fr)_minmax(320px,420px)] items-center gap-14 px-8 py-12 max-lg:grid-cols-1">
      <div className="space-y-8">
        <div>
          <span className="text-sm font-medium text-primary-ink">
            {t("root.title")}
          </span>
          <h2 className="mt-3 max-w-lg text-3xl font-semibold tracking-tight text-balance">
            {t("root.description")}
          </h2>
          <p className="mt-4 max-w-md text-sm leading-6 text-muted-foreground">
            This is the top level of your organization; everything else lives
            beneath it.
          </p>
        </div>
        <Link
          href="/organization/import"
          className="group flex items-center gap-4 rounded-surface border bg-card p-4 pe-5 transition-colors hover:border-primary/40 hover:bg-primary/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-control bg-primary-tint text-primary-ink">
            <UploadCloud className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1 font-semibold">
            {t("root.import")}
          </span>
          <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
      <form
        onSubmit={submit}
        className="space-y-5 border-s ps-8 max-lg:border-s-0 max-lg:border-t max-lg:ps-0 max-lg:pt-8"
      >
        <div className="space-y-1.5">
          <Label htmlFor="root-name">{t("root.name")}</Label>
          <Input
            id="root-name"
            required
            autoFocus
            value={name}
            onChange={(event) => {
              nameTouched.current = true;
              setName(event.target.value);
              if (!codeTouched.current)
                setCode(organizationCodeSuggestion(event.target.value));
            }}
            placeholder={t("root.namePlaceholder")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="root-code">{t("root.code")}</Label>
          <Input
            id="root-code"
            required
            value={code}
            onChange={(event) => {
              codeTouched.current = true;
              setCode(event.target.value.toUpperCase());
            }}
            placeholder={t("root.codePlaceholder")}
          />
          <p className="text-xs text-muted-foreground">
            {t("root.codeHint")}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>{t("root.type")}</Label>
          <div className="flex h-9 items-center rounded-surface border bg-inlay px-3 text-sm">
            {t("root.organization")}{" "}
            <span className="ms-auto text-xs text-muted-foreground">
              {t("root.systemDefined")}
            </span>
          </div>
        </div>
        <EffectiveDateField
          value={effectiveDate}
          onChange={setEffectiveDate}
          today={today}
        />
        <FormError error={mutations.createRoot.error} />
        <Button
          type="submit"
          className="w-full"
          disabled={
            mutations.createRoot.isLoading || !name.trim() || !code.trim()
          }
        >
          {mutations.createRoot.isLoading
            ? t("root.saving")
            : effectiveDate === today
              ? t("root.create")
              : t("root.schedule")}
        </Button>
      </form>
    </div>
  );
}

export function UnitFormPanel({
  mode,
  today,
  model,
  types,
  createdTypeId,
  mutations,
  onClose,
  onCreateType,
  onSaved,
}: {
  mode: UnitFormMode;
  today: string;
  model: OrganizationHierarchyModel;
  types: OrganizationalUnitTypeDto[];
  createdTypeId: string | null;
  mutations: OrganizationMutations;
  onClose: () => void;
  onCreateType: () => void;
  onSaved: (id: string, effectiveDate: string) => void;
}) {
  const t = useTranslations("organization");
  const editing = mode?.kind === "edit";
  const isRoot = mode?.kind === "edit" && mode.unit.parentId === null;
  const globalAdd = mode?.kind === "add" && !mode.parentId;
  const contextualParent =
    mode?.kind === "add" && mode.parentId ? model.byId.get(mode.parentId) : null;
  const initialName = mode?.kind === "edit" ? mode.unit.name : "";
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(mode?.kind === "edit" ? mode.unit.code : "");
  const codeTouched = useRef(false);
  const [typeId, setTypeId] = useState(
    mode?.kind === "edit" ? mode.unit.typeId : ""
  );
  const [parentId, setParentId] = useState(
    mode?.kind === "add" ? (mode.parentId ?? "") : ""
  );
  const [effectiveDate, setEffectiveDate] = useState(today);
  const proposedHierarchy = useOrganizationHierarchy(
    effectiveDate,
    !editing && effectiveDate !== today
  );
  const parentModel = useMemo(
    () =>
      effectiveDate === today
        ? model
        : proposedHierarchy.data
          ? buildOrganizationHierarchy(proposedHierarchy.data)
          : null,
    [effectiveDate, model, proposedHierarchy.data, today]
  );

  useEffect(() => {
    setName(initialName);
    setCode(mode?.kind === "edit" ? mode.unit.code : "");
    codeTouched.current = mode?.kind === "edit";
    setTypeId(mode?.kind === "edit" ? mode.unit.typeId : "");
    setParentId(mode?.kind === "add" ? (mode.parentId ?? "") : "");
    setEffectiveDate(today);
  }, [initialName, mode, today]);

  useEffect(() => {
    if (createdTypeId) setTypeId(createdTypeId);
  }, [createdTypeId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!mode) return;
    try {
      if (mode.kind === "edit") {
        const saved = await mutations.changeUnit.mutateAsync({
          id: mode.unit.id,
          version: mode.unit.version,
          request: { name: name.trim(), typeId, effectiveDate },
        });
        toast.success(
          effectiveDate === today ? t("unitForm.updated") : t("unitForm.changeScheduled")
        );
        onSaved(saved.id, effectiveDate);
      } else {
        const saved = await mutations.createUnit.mutateAsync({
          name: name.trim(),
          code: code.trim(),
          typeId,
          parentId,
          effectiveDate,
        });
        toast.success(
          effectiveDate === today ? t("unitForm.added") : t("unitForm.unitScheduled")
        );
        onSaved(saved.id, effectiveDate);
      }
      onClose();
    } catch {
      /* mutation state stays in place */
    }
  }

  const mutation = editing ? mutations.changeUnit : mutations.createUnit;
  const title = editing
    ? isRoot
      ? t("unitForm.editOrganization")
      : t("unitForm.editUnit", { name: mode?.kind === "edit" ? mode.unit.name : "" })
    : contextualParent
      ? t("unitForm.addUnder", { name: contextualParent.name })
      : t("unitForm.add");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
        <p className="min-w-0 truncate text-base font-semibold">{title}</p>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("unitForm.close")}
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <form
        id="organization-unit-form"
        onSubmit={submit}
        className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4"
      >
          <div className="space-y-1.5">
            <Label htmlFor="unit-name">{t("unitForm.name")}</Label>
            <Input
              id="unit-name"
              required
              autoFocus
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (!editing && !codeTouched.current)
                  setCode(organizationCodeSuggestion(event.target.value));
              }}
            />
          </div>
          {!editing ? (
            <div className="space-y-1.5">
              <Label htmlFor="unit-code">{t("unitForm.code")}</Label>
              <Input
                id="unit-code"
                required
                value={code}
                onChange={(event) => {
                  codeTouched.current = true;
                  setCode(event.target.value.toUpperCase());
                }}
              />
            </div>
          ) : null}
          {!isRoot ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="unit-type">{t("unitForm.type")}</Label>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  onClick={onCreateType}
                >
                  {t("unitForm.createType")}
                </Button>
              </div>
              <TypePicker id="unit-type" value={typeId} types={types} onChange={setTypeId} />
            </div>
          ) : null}
          {globalAdd ? (
            <div className="space-y-1.5">
              <Label>{t("unitForm.parent")}</Label>
              {parentModel ? (
                <HierarchyPicker
                  value={parentId || null}
                  model={parentModel}
                  label={t("unitForm.parentUnit")}
                  onChange={setParentId}
                />
              ) : (
                <div className="rounded-surface border bg-inlay px-3 py-4 text-sm text-muted-foreground">
                  Resolving eligible parents for {effectiveDate}…
                </div>
              )}
              {proposedHierarchy.error ? (
                <FormError error={proposedHierarchy.error} />
              ) : null}
            </div>
          ) : null}
          <EffectiveDateField
            value={effectiveDate}
            onChange={setEffectiveDate}
            today={today}
          />
          <FormError error={mutation.error} />
        </form>
        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("unitForm.cancel")}
          </Button>
          <Button
            form="organization-unit-form"
            type="submit"
            disabled={
              mutation.isLoading ||
              !name.trim() ||
              (!isRoot && !typeId) ||
              (!editing &&
                (!code.trim() || !parentId || (globalAdd && !parentModel)))
            }
          >
            {mutation.isLoading
              ? t("unitForm.saving")
              : effectiveDate === today
                ? editing
                  ? t("unitForm.save")
                  : t("unitForm.add")
                : editing
                  ? t("unitForm.schedule")
                  : t("unitForm.scheduleUnit")}
          </Button>
        </div>
    </div>
  );
}

export function CreateTypeDialog({
  open,
  mutations,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  mutations: OrganizationMutations;
  onOpenChange: (open: boolean) => void;
  onCreated: (type: OrganizationalUnitTypeDto) => void;
}) {
  const t = useTranslations("organization");
  const [name, setName] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mutations.createType.isLoading) return;
    try {
      const type = await mutations.createType.mutateAsync({
        name: name.trim(),
      });
      onCreated(type);
      setName("");
      onOpenChange(false);
      toast.success(t("types.created"));
    } catch {
      /* preserve */
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("types.createTitle")}</DialogTitle>
          <DialogDescription>
            {t("types.createDescription")}
          </DialogDescription>
        </DialogHeader>
        <form id="create-unit-type" onSubmit={submit} className="space-y-3">
          <Label htmlFor="type-name">{t("types.name")}</Label>
          <Input
            id="type-name"
            autoFocus
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <FormError error={mutations.createType.error} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("types.cancel")}
          </Button>
          <Button
            form="create-unit-type"
            type="submit"
            disabled={!name.trim() || mutations.createType.isLoading}
          >
            {mutations.createType.isLoading ? t("types.creating") : t("types.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ManageTypesPanel({
  types,
  mutations,
  onClose,
  onCreateType,
}: {
  types: OrganizationalUnitTypeDto[];
  mutations: OrganizationMutations;
  onClose: () => void;
  onCreateType: () => void;
}) {
  const t = useTranslations("organization");
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const builtIn = types.filter((type) => type.isBuiltIn);
  const custom = types.filter((type) => !type.isBuiltIn);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{t("types.manage")}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {t("types.manageDescription")}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("types.close")}
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
          <section>
            <div className="mb-2.5">
              <h3 className="text-sm font-semibold">{t("types.builtIn")}</h3>
              <p className="text-xs text-muted-foreground">{t("types.builtInDescription")}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {builtIn.map((type) => (
                <span
                  key={type.id}
                  className="rounded-control border bg-inlay px-2.5 py-1 text-sm"
                >
                  {type.displayName}
                </span>
              ))}
            </div>
          </section>
          <section>
            <div className="mb-2 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold">{t("types.custom")}</h3>
                <p className="text-xs text-muted-foreground">
                  {t("types.customDescription")}
                </p>
              </div>
              <Button size="sm" onClick={onCreateType}>
                <Plus className="h-3.5 w-3.5" />
                {t("types.new")}
              </Button>
            </div>
            {custom.length ? (
              <div className="divide-y border-y">
                {custom.map((type) => (
                  <div
                    key={type.id}
                    className="flex min-h-14 items-center gap-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      {editing === type.id ? (
                        <Input
                          autoFocus
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                        />
                      ) : (
                        <p className="font-medium">{type.displayName}</p>
                      )}
                    </div>
                    {editing === type.id ? (
                      <>
                        <Button
                          size="sm"
                          disabled={
                            mutations.renameType.isLoading || !name.trim()
                          }
                          onClick={async () => {
                            if (mutations.renameType.isLoading) return;
                            try {
                              await mutations.renameType.mutateAsync({
                                id: type.id,
                                request: { name },
                              });
                              setEditing(null);
                              toast.success(t("types.renamed"));
                            } catch {
                              return;
                            }
                          }}
                        >
                          {t("types.save")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing(null)}
                        >
                          {t("types.cancel")}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditing(type.id);
                            setName(type.displayName);
                          }}
                        >
                          {t("types.rename")}
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          disabled={mutations.deleteType.isLoading}
                          aria-label={t("types.delete", { name: type.displayName })}
                          onClick={async () => {
                            if (mutations.deleteType.isLoading) return;
                            try {
                              await mutations.deleteType.mutateAsync(type.id);
                              toast.success(t("types.deleted"));
                            } catch {
                              return;
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-surface border border-dashed px-3 py-4 text-sm text-muted-foreground">
                {t("types.none")}
              </p>
            )}
          </section>
          <FormError
            error={mutations.renameType.error ?? mutations.deleteType.error}
          />
      </div>
    </div>
  );
}

export function MoveReviewDialog({
  proposal,
  today,
  model,
  resolving,
  mutations,
  onChange,
  onOpenChange,
  onMoved,
}: {
  proposal: MoveProposal | null;
  today: string;
  model: OrganizationHierarchyModel;
  resolving?: boolean;
  mutations: OrganizationMutations;
  onChange: (proposal: MoveProposal) => void;
  onOpenChange: (open: boolean) => void;
  onMoved: (id: string, effectiveDate: string) => void;
}) {
  const t = useTranslations("organization");
  const english = useLocale() === "en";
  const problemMessage = (error: unknown) =>
    english ? translateOrganizationError(error).message : t(`problem.${translateOrganizationError(error).kind}`);
  if (!proposal) return null;
  const activeProposal = proposal;
  const source = model.byId.get(activeProposal.sourceId);
  const from = activeProposal.fromParentId
    ? model.byId.get(activeProposal.fromParentId)
    : null;
  const to = activeProposal.toParentId
    ? model.byId.get(activeProposal.toParentId)
    : null;
  const invalid =
    !activeProposal.toParentId ||
    isInvalidMoveTarget(
      model,
      activeProposal.sourceId,
      activeProposal.toParentId
    );
  // Drag entry already fixed the destination; only ask for it again when the
  // Move was started explicitly or the dragged destination no longer resolves.
  const needsDestination = activeProposal.entry === "explicit" || !to;
  const moveVerb = activeProposal.subordinateCount > 0 ? t("move.branch") : t("move.unit");
  async function submit() {
    if (!source || !activeProposal.toParentId || invalid) return;
    try {
      await mutations.moveUnit.mutateAsync({
        id: source.id,
        version: activeProposal.version,
        request: {
          targetParentId: activeProposal.toParentId,
          effectiveDate: activeProposal.effectiveDate,
        },
      });
      toast.success(
        activeProposal.effectiveDate === today ? t("move.moved") : t("move.scheduled")
      );
      onOpenChange(false);
      onMoved(source.id, activeProposal.effectiveDate);
    } catch (error) {
      onChange({
        ...activeProposal,
        error: translateOrganizationError(error).message,
      });
    }
  }
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("move.review")}</DialogTitle>
          <DialogDescription>
            Everything beneath {source?.name ?? "this unit"} moves with it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 rounded-surface border p-4 text-sm">
          <div className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-3">
            <span className="text-muted-foreground">{t("move.unitLabel")}</span>
            <strong className="min-w-0 truncate">{source?.name}</strong>
            <span className="text-muted-foreground">{t("move.from")}</span>
            <span className="min-w-0 truncate">{from?.name ?? t("move.topLevel")}</span>
            {needsDestination ? null : (
              <>
                <span className="text-muted-foreground">{t("move.to")}</span>
                <span className="min-w-0 truncate">
                  {to?.name}
                  {to ? (
                    <span className="ms-1.5 font-mono text-xs text-muted-foreground">
                      {to.code}
                    </span>
                  ) : null}
                </span>
              </>
            )}
            <span className="text-muted-foreground">{t("move.effectiveDate")}</span>
            <DatePicker
              aria-label={t("move.effectiveDate")}
              value={proposal.effectiveDate}
              onChange={(effectiveDate) =>
                onChange({
                  ...proposal,
                  effectiveDate,
                  // Explicit entry re-picks on a date change; drag entry keeps
                  // its destination and re-validates against the new date.
                  toParentId:
                    proposal.entry === "drag" ? proposal.toParentId : null,
                  error: null,
                })
              }
            />
            <span className="text-muted-foreground">{t("move.alsoMoving")}</span>
            <span>
              {proposal.subordinateCount === 0
                ? t("move.nothingBeneath")
                : t("move.beneath", { count: proposal.subordinateCount })}
            </span>
          </div>
          {needsDestination ? (
            <div>
              <Label>{t("move.newParent")}</Label>
              {resolving ? (
                <div className="mt-1 rounded-surface border px-3 py-4 text-muted-foreground">
                  Resolving eligible destinations for {proposal.effectiveDate}…
                </div>
              ) : (
                <div className="mt-1">
                  <HierarchyPicker
                    value={proposal.toParentId}
                    model={model}
                    sourceId={proposal.sourceId}
                    label={t("move.destination")}
                    onChange={(toParentId) =>
                      onChange({ ...proposal, toParentId, error: null })
                    }
                  />
                </div>
              )}
            </div>
          ) : null}
        </div>
        {proposal.error || mutations.moveUnit.error ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t("move.notAccepted")}</AlertTitle>
            <AlertDescription>
              {(english ? proposal.error : null) ??
                problemMessage(mutations.moveUnit.error)}{" "}
              {t("move.kept")}
            </AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("move.cancel")}
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={resolving || invalid || mutations.moveUnit.isLoading}
          >
            {mutations.moveUnit.isLoading
              ? t("move.moving")
              : proposal.effectiveDate === today
                ? moveVerb
                : proposal.effectiveDate > today
                  ? t("move.schedule")
                  : t("move.historical")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function InactivateDialog({
  unit,
  today,
  model,
  mutations,
  onOpenChange,
  onDone,
  onSelectDescendant,
}: {
  unit: OrganizationUnitStateDto | null;
  today: string;
  model: OrganizationHierarchyModel;
  mutations: OrganizationMutations;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
  onSelectDescendant: (id: string) => void;
}) {
  const t = useTranslations("organization");
  const [date, setDate] = useState(today);
  const proposedHierarchy = useOrganizationHierarchy(
    date,
    unit !== null && date !== today
  );
  const dateModel = useMemo(
    () =>
      date === today
        ? model
        : proposedHierarchy.data
          ? buildOrganizationHierarchy(proposedHierarchy.data)
          : null,
    [date, model, proposedHierarchy.data, today]
  );
  if (!unit) return null;
  const activeUnit = unit;
  const descendants = dateModel?.descendantsById.get(activeUnit.id)?.size ?? 0;
  const blockingUnit = dateModel
    ? deepestBlockingUnit(dateModel, activeUnit.id)
    : null;
  const blocked = descendants > 0;
  async function submit() {
    try {
      await mutations.inactivateUnit.mutateAsync({
        id: activeUnit.id,
        version: activeUnit.version,
        request: { effectiveDate: date },
      });
      toast.success(
        date === today ? t("inactivate.inactivated") : t("inactivate.scheduled")
      );
      onOpenChange(false);
      onDone();
    } catch {
      return;
    }
  }
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {blocked
              ? t("inactivate.blockedTitle", { name: unit.name })
              : t("inactivate.title", { name: unit.name })}
          </DialogTitle>
          <DialogDescription>
            {blocked
              ? t("inactivate.blockedDescription", { name: unit.name, count: descendants })
              : t("inactivate.description")}
          </DialogDescription>
        </DialogHeader>
        <EffectiveDateField value={date} onChange={setDate} today={today} />
        {!dateModel ? (
          <div className="rounded-surface border bg-inlay px-3 py-4 text-sm text-muted-foreground">
            {t("inactivate.checking", { date })}
          </div>
        ) : blocked && blockingUnit ? (
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => {
              onOpenChange(false);
              onSelectDescendant(blockingUnit);
            }}
          >
            {t("inactivate.goToBlocking")}
          </Button>
        ) : null}
        <FormError
          error={proposedHierarchy.error ?? mutations.inactivateUnit.error}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {blocked ? t("inactivate.close") : t("inactivate.cancel")}
          </Button>
          {!blocked ? (
            <Button
              variant="destructive"
              onClick={() => void submit()}
              disabled={!dateModel || mutations.inactivateUnit.isLoading}
            >
              {date === today ? t("inactivate.confirm") : t("inactivate.schedule")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UpcomingChangesSheet({
  open,
  changes,
  canManage,
  today,
  mutations,
  onOpenChange,
  onViewDate,
  onCancel,
}: {
  open: boolean;
  changes: OrganizationChangeDto[];
  canManage: boolean;
  today: string;
  mutations: OrganizationMutations;
  onOpenChange: (open: boolean) => void;
  onViewDate: (date: string) => void;
  onCancel: (change: OrganizationChangeDto) => void;
}) {
  const t = useTranslations("organization");
  const events = useOrganizationEvents();
  const groups = useMemo(() => {
    const result = new Map<string, OrganizationChangeDto[]>();
    for (const change of changes) {
      if (change.isCancelled || change.effectiveDate <= today) continue;
      const items = result.get(change.effectiveDate) ?? [];
      items.push(change);
      result.set(change.effectiveDate, items);
    }
    return result;
  }, [changes, today]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        className="sm:max-w-xl"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <SheetHeader>
          <SheetTitle>{t("upcoming.title")}</SheetTitle>
          <SheetDescription>
            {t("upcoming.description")}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-6 overflow-y-auto px-4 pb-6">
          {[...groups.entries()].map(([date, items]) => (
            <section key={date}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{date}</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onViewDate(date);
                    onOpenChange(false);
                  }}
                >
                  {t("upcoming.view")}
                </Button>
              </div>
              <div className="divide-y border-y">
                {items.map((change) => (
                  <div key={change.id} className="py-3">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {events.label(change)} · {change.unitName}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {events.firstContext(change)} · {change.unitCode}
                        </p>
                      </div>
                      {canManage ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onCancel(change)}
                        >
                          {t("upcoming.cancel")}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
        <FormError error={mutations.cancelChange.error} />
      </SheetContent>
    </Sheet>
  );
}

export function CorrectionPanel({
  unit,
  effectiveDate,
  model,
  types,
  mutations,
  onClose,
  onDone,
}: {
  unit: OrganizationUnitStateDto | null;
  effectiveDate: string;
  model: OrganizationHierarchyModel;
  types: OrganizationalUnitTypeDto[];
  mutations: OrganizationMutations;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("organization");
  const [name, setName] = useState(unit?.name ?? "");
  const [code, setCode] = useState(unit?.code ?? "");
  const [typeId, setTypeId] = useState(unit?.typeId ?? "");
  const [parentId, setParentId] = useState(unit?.parentId ?? "");
  const [lifecycleState, setLifecycleState] = useState<"Active" | "Inactive">(
    unit?.lifecycleState === "Inactive" ? "Inactive" : "Active"
  );
  const [reason, setReason] = useState("");
  const isRoot = unit?.parentId === null;
  const proposedHierarchy = useOrganizationHierarchy(
    effectiveDate,
    effectiveDate !== model.asOf
  );
  const correctionModel = useMemo(
    () =>
      effectiveDate === model.asOf
        ? model
        : proposedHierarchy.data
          ? buildOrganizationHierarchy(proposedHierarchy.data)
          : null,
    [effectiveDate, model, proposedHierarchy.data]
  );
  useEffect(() => {
    setName(unit?.name ?? "");
    setCode(unit?.code ?? "");
    setTypeId(unit?.typeId ?? "");
    setParentId(unit?.parentId ?? "");
    setLifecycleState(
      unit?.lifecycleState === "Inactive" ? "Inactive" : "Active"
    );
    setReason("");
  }, [unit]);
  const initialLifecycle =
    unit?.lifecycleState === "Inactive" ? "Inactive" : "Active";
  const codeChanged = unit ? code.trim() !== unit.code : false;
  const recordChanged = unit
    ? name !== unit.name ||
      typeId !== unit.typeId ||
      (unit.parentId !== null && parentId !== unit.parentId) ||
      lifecycleState !== initialLifecycle
    : false;
  const saving =
    mutations.correctUnit.isLoading || mutations.correctCode.isLoading;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!unit || !correctionModel) return;
    try {
      let version = unit.version;
      if (codeChanged) {
        const after = await mutations.correctCode.mutateAsync({
          id: unit.id,
          version,
          request: { code: code.trim(), reason },
        });
        version = after.version;
      }
      if (recordChanged) {
        await mutations.correctUnit.mutateAsync({
          id: unit.id,
          version,
          request: {
            name,
            typeId,
            parentId: unit.parentId === null ? null : parentId,
            lifecycleState,
            effectiveDate,
            reason,
          },
        });
      }
      toast.success(t("correction.corrected"));
      onClose();
      onDone();
    } catch {
      return;
    }
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">
            {t("correction.title")}
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            Effective {effectiveDate}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("correction.close")}
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <form
        id="correct-state"
        onSubmit={submit}
        className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4"
      >
          <div className="space-y-1.5">
            <Label htmlFor="correct-name">{t("correction.name")}</Label>
            <Input
              id="correct-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="correct-code">{t("correction.code")}</Label>
            <Input
              id="correct-code"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
            />
            {codeChanged ? (
              <p className="text-xs text-warning">
                Imports and integrations may still reference {unit?.code}.
              </p>
            ) : null}
          </div>
          {!isRoot ? (
            <div className="space-y-1.5">
              <Label>{t("correction.type")}</Label>
              <TypePicker value={typeId} types={types} onChange={setTypeId} />
            </div>
          ) : null}
          {!isRoot ? (
            <div className="space-y-1.5">
              <Label>{t("correction.parent")}</Label>
              {correctionModel ? (
                <HierarchyPicker
                  value={parentId || null}
                  model={correctionModel}
                  sourceId={unit?.id}
                  label={t("correction.parent")}
                  onChange={setParentId}
                />
              ) : (
                <div className="rounded-surface border bg-inlay px-3 py-4 text-sm text-muted-foreground">
                  Resolving the hierarchy for {effectiveDate}…
                </div>
              )}
            </div>
          ) : null}
          {!isRoot ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("correction.status")}</legend>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={lifecycleState === "Active" ? "secondary" : "outline"}
                  onClick={() => setLifecycleState("Active")}
                >
                  {t("correction.active")}
                </Button>
                <Button
                  type="button"
                  variant={
                    lifecycleState === "Inactive" ? "secondary" : "outline"
                  }
                  onClick={() => setLifecycleState("Inactive")}
                >
                  {t("correction.inactive")}
                </Button>
              </div>
            </fieldset>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="correct-reason">{t("correction.reason")}</Label>
            <Textarea
              id="correct-reason"
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t("correction.reasonPlaceholder")}
            />
          </div>
          <FormError
            error={
              proposedHierarchy.error ??
              mutations.correctCode.error ??
              mutations.correctUnit.error
            }
          />
        </form>
        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <Button variant="outline" onClick={onClose}>
            {t("correction.cancel")}
          </Button>
          <Button
            form="correct-state"
            type="submit"
            disabled={
              !correctionModel ||
              !reason.trim() ||
              (!codeChanged && !recordChanged) ||
              saving
            }
          >
            {t("correction.submit")}
          </Button>
        </div>
    </div>
  );
}
