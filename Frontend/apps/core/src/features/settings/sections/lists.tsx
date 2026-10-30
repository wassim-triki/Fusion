"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ApiError, type CompanyListDto, type CompanyListValueDto, type FusionSettingsSection } from "@repo/api";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  cn,
} from "@repo/ds";
import { PageError, SettingsBlock, SettingsPage, SettingsRows, StatusBadge, useSettingsSectionName } from "@repo/ds/shell";
import { Archive, ArrowDown, ArrowUp, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useCompanyLists, useListMutations } from "@/features/catalog/api/use-catalog";

/** Lists whose values something counts (jobs or people); the others have no users yet. */
const COUNTED = new Set(["employment-types", "levels", "job-families"]);

/**
 * Settings › Lists: the values people pick from, as the company names them. Every change saves at once. A value in
 * use is retired, never deleted, so what was recorded keeps its words; an unused one can be deleted.
 */
export function ListsSettings({ section }: { section: FusionSettingsSection }) {
  const t = useTranslations("catalog.lists");
  const title = useSettingsSectionName()(section);
  const editable = section.access === "manage";
  const lists = useCompanyLists();

  if (lists.error && !lists.data) {
    return (
      <SettingsPage title={title}>
        <PageError title={t("didNotLoad")} onRetry={() => void lists.refetch()} />
      </SettingsPage>
    );
  }

  return (
    <SettingsPage title={title} lastChange={section.lastChange} setUpAt={section.setUpAt} viewOnly={!editable} loading={!lists.data}>
      {lists.data?.map((list) => <ListBlock key={list.id} list={list} editable={editable} />)}
    </SettingsPage>
  );
}

function ListBlock({ list, editable }: { list: CompanyListDto; editable: boolean }) {
  const t = useTranslations("catalog.lists");
  const mutations = useListMutations();
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const active = list.values.filter((value) => !value.isRetired);
  const retired = list.values.filter((value) => value.isRetired);

  async function add(event: FormEvent) {
    event.preventDefault();
    const text = label.trim();
    if (!text) return;
    setError(null);
    try {
      await mutations.add.mutateAsync({ list: list.id, label: text });
      setLabel("");
      toast.success(t("added", { label: text }));
    } catch (failure) {
      setError(failure instanceof ApiError && failure.status === 409 ? t("exists") : t("didNotSave"));
    }
  }

  function move(index: number, by: -1 | 1) {
    const ids = active.map((value) => value.id);
    [ids[index], ids[index + by]] = [ids[index + by]!, ids[index]!];
    mutations.reorder.mutate({ list: list.id, ids: [...ids, ...retired.map((value) => value.id)] });
  }

  return (
    <SettingsBlock title={t(`name.${list.id}`)} meta={active.length || undefined}>
      <SettingsRows>
        {active.length === 0 ? <p className="px-5 py-4 type-body text-muted-foreground">{t("empty")}</p> : null}
        {active.map((value, index) => (
          <ValueRow
            key={value.id}
            list={list.id}
            value={value}
            editable={editable}
            onUp={index > 0 ? () => move(index, -1) : undefined}
            onDown={index < active.length - 1 ? () => move(index, 1) : undefined}
          />
        ))}
        {retired.map((value) => (
          <ValueRow key={value.id} list={list.id} value={value} editable={editable} />
        ))}
        {editable ? (
          <form onSubmit={(event) => void add(event)} className="flex items-center gap-2.5 px-5 py-2.5">
            <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <Input
              value={label}
              maxLength={100}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={t("addPlaceholder")}
              aria-label={t("add")}
              aria-invalid={Boolean(error)}
              className="h-8 border-transparent bg-transparent px-1 shadow-none focus-visible:border-input dark:bg-transparent"
            />
            {label.trim() ? (
              <Button type="submit" size="sm" disabled={mutations.add.isLoading}>
                {t("addAction")}
              </Button>
            ) : null}
          </form>
        ) : null}
      </SettingsRows>
      {error ? <p role="alert" className="type-meta text-destructive">{error}</p> : null}
    </SettingsBlock>
  );
}

function ValueRow({
  list,
  value,
  editable,
  onUp,
  onDown,
}: {
  list: CompanyListDto["id"];
  value: CompanyListValueDto;
  editable: boolean;
  onUp?: () => void;
  onDown?: () => void;
}) {
  const t = useTranslations("catalog.lists");
  const words = useTranslations("catalog");
  const mutations = useListMutations();
  const [renaming, setRenaming] = useState(false);
  const [label, setLabel] = useState(value.label);

  async function rename(event: FormEvent) {
    event.preventDefault();
    const text = label.trim();
    if (!text || text === value.label) {
      setRenaming(false);
      return;
    }
    try {
      await mutations.rename.mutateAsync({ list, id: value.id, label: text });
      toast.success(t("renamed", { label: text }));
      setRenaming(false);
    } catch (failure) {
      toast.error(failure instanceof ApiError && failure.status === 409 ? t("exists") : t("didNotSave"));
    }
  }

  async function setRetired(retired: boolean) {
    try {
      await mutations.retire.mutateAsync({ list, id: value.id, retired });
      toast.success(t(retired ? "retired" : "restored", { label: value.label }));
    } catch {
      toast.error(t("didNotSave"));
    }
  }

  async function remove() {
    try {
      await mutations.remove.mutateAsync({ list, id: value.id });
      toast.success(t("deleted", { label: value.label }));
    } catch {
      toast.error(t("didNotSave"));
    }
  }

  const usage = COUNTED.has(list) && value.usageCount > 0
    ? t(`usage.${list as "employment-types" | "levels" | "job-families"}`, { count: value.usageCount })
    : null;

  return (
    <div className="flex min-h-[52px] items-center gap-3 px-5 py-2">
      {renaming ? (
        <form onSubmit={(event) => void rename(event)} className="flex min-w-0 flex-1 items-center gap-2">
          <Input
            autoFocus
            value={label}
            maxLength={100}
            onChange={(event) => setLabel(event.target.value)}
            onBlur={(event) => void rename(event)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setLabel(value.label);
                setRenaming(false);
              }
            }}
            aria-label={t("rename")}
            className="h-8"
          />
        </form>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className={cn("truncate type-body", value.isRetired && "text-muted-foreground")}>{value.label}</span>
          {value.isRetired ? <StatusBadge tone="muted">{words("retired")}</StatusBadge> : null}
        </span>
      )}
      {usage ? <span className="shrink-0 type-meta tabular-nums text-muted-foreground">{usage}</span> : null}
      {editable && !renaming ? (
        <span className="flex shrink-0 items-center gap-0.5">
          {!value.isRetired ? (
            <>
              <Button variant="ghost" size="icon-sm" aria-label={t("moveUp")} disabled={!onUp} onClick={onUp}>
                <ArrowUp className="size-3.5" aria-hidden />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label={t("moveDown")} disabled={!onDown} onClick={onDown}>
                <ArrowDown className="size-3.5" aria-hidden />
              </Button>
            </>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={words("more")}>
                <MoreHorizontal className="size-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => { setLabel(value.label); setRenaming(true); }}>
                <Pencil className="size-4" aria-hidden />
                {t("rename")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void setRetired(!value.isRetired)}>
                {value.isRetired ? <RotateCcw className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />}
                {value.isRetired ? words("bringBack") : words("retire")}
              </DropdownMenuItem>
              {!value.inUse ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => void remove()}>
                    <Trash2 className="size-4" aria-hidden />
                    {t("delete")}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      ) : null}
    </div>
  );
}
