"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { CompanyValueDto, FusionSettingsSection } from "@repo/api";
import { Button, Input } from "@repo/ds";
import { AsyncButton, SettingsPage, useSettingsSectionName } from "@repo/ds/shell";
import { Pencil, Plus, X } from "@repo/ds/icons";
import { PageFailure } from "@repo/auth";
import { useCompanyValueCommands, useCompanyValues } from "@/features/performance/api/use-conversations";
import { useRefreshSettingsSections } from "../api";
import { useSaveFailure } from "../say";

const MAX_VALUES = 12;

/**
 * Settings › Values (D-36): the company's short list praise names. A company starts with four starter values; each
 * change saves at once. Removing a value takes it off the list, and praise already given keeps its name.
 */
export function ValuesSettings({ section }: { section: FusionSettingsSection }) {
  const t = useTranslations("settings.values");
  const title = useSettingsSectionName()(section);
  const editable = section.access === "manage";
  const values = useCompanyValues();
  const commands = useCompanyValueCommands();
  const refresh = useRefreshSettingsSections();
  const failure = useSaveFailure();
  const [adding, setAdding] = useState("");
  const error = failure(commands.add.error ?? commands.rename.error ?? commands.remove.error, t("notSaved"));

  if (values.error && !values.data) {
    return (
      <SettingsPage title={title}>
        <PageFailure error={values.error} onRetry={() => void values.refetch()} headingLevel={2} />
      </SettingsPage>
    );
  }
  const list = values.data ?? [];
  const full = list.length >= MAX_VALUES;
  const add = async () => {
    const name = adding.trim();
    if (!name) return;
    await commands.add.mutateAsync(name).then(() => { setAdding(""); refresh(); }).catch(() => undefined);
  };

  return (
    <SettingsPage title={title} lastChange={section.lastChange} setUpAt={section.setUpAt} viewOnly={!editable} loading={!values.data}>
      <section className="grid gap-3">
        {list.length === 0 ? <p className="type-body-secondary text-muted-foreground">{t("none")}</p> : null}
        <ul className="grid gap-2">
          {list.map((value) => (
            <ValueRow key={value.id} value={value} editable={editable} onChanged={refresh} />
          ))}
        </ul>
        {editable ? (
          full ? (
            <p className="type-meta text-muted-foreground">{t("full")}</p>
          ) : (
            <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void add(); }}>
              <Input aria-label={t("add")} placeholder={t("placeholder")} maxLength={60} value={adding} onChange={(event) => setAdding(event.target.value)} className="max-w-sm" />
              <AsyncButton type="submit" variant="outline" pending={commands.add.isLoading} disabled={!adding.trim()}>
                <Plus className="size-4" data-icon="inline-start" /> {t("add")}
              </AsyncButton>
            </form>
          )
        ) : null}
        {error ? <p className="type-body text-destructive" role="alert">{error}</p> : null}
      </section>
    </SettingsPage>
  );
}

function ValueRow({ value, editable, onChanged }: { value: CompanyValueDto; editable: boolean; onChanged: () => void }) {
  const t = useTranslations("settings.values");
  const commands = useCompanyValueCommands();
  const [name, setName] = useState<string | null>(null);
  if (name !== null) {
    return (
      <li>
        <form
          className="flex items-center gap-2 rounded-control bg-card px-3 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            void commands.rename.mutateAsync({ id: value.id, name: name.trim() }).then(() => { setName(null); onChanged(); }).catch(() => undefined);
          }}
        >
          <Input autoFocus aria-label={t("rename", { name: value.name })} maxLength={60} value={name} onChange={(event) => setName(event.target.value)} />
          <AsyncButton type="submit" size="sm" pending={commands.rename.isLoading} disabled={!name.trim()}>{t("save")}</AsyncButton>
          <Button type="button" size="sm" variant="ghost" onClick={() => setName(null)}>{t("cancel")}</Button>
        </form>
      </li>
    );
  }
  return (
    <li className="group flex items-center gap-2 rounded-control bg-card px-4 py-2.5">
      <span className="min-w-0 flex-1 truncate type-body text-foreground">{value.name}</span>
      {editable ? (
        <>
          <Button size="icon-sm" variant="ghost" aria-label={t("rename", { name: value.name })} onClick={() => setName(value.name)}>
            <Pencil className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("remove", { name: value.name })}
            disabled={commands.remove.isLoading}
            onClick={() => void commands.remove.mutateAsync(value.id).then(onChanged).catch(() => undefined)}
          >
            <X className="size-4" />
          </Button>
        </>
      ) : null}
    </li>
  );
}
