"use client";

import { useCallback, useMemo } from "react";
import type { FusionSettingsSection, OrgChartAudience, PeopleDataSettingsDto } from "@repo/api";
import { useSettingsConflictSaver } from "@repo/api/query";
import { useStagedSettings } from "@repo/api/react";
import { Checkbox, cn, Switch } from "@repo/ds";
import { OptionCards } from "@repo/ds/choice";
import {
  PageError,
  SettingsBlock,
  SettingsPage,
  SettingsRow,
  SettingsRows,
  SettingsSaveBar,
  SettingsValue,
  useSettingsSectionName,
} from "@repo/ds/shell";
import {
  usePeopleDataSettings,
  useUpdatePeopleDataSettings,
} from "@/features/settings/api/use-tenant-settings";
import { sayInEnglish, useSaveFailure, useSettingsSay, type Say } from "@/features/settings/say";

type FieldKey = "firstName" | "lastName" | "email" | "hireDate" | "phone" | "jobTitle" | "workLocation" | "employmentType";
type Audience = "required" | "visibleToEmployee" | "visibleToManager";

interface FieldRule {
  required: boolean;
  visibleToEmployee: boolean;
  visibleToManager: boolean;
}

export interface EmployeeFieldsDraft {
  fields: Record<FieldKey, FieldRule>;
  selfService: { canEditPreferredName: boolean; canEditPhone: boolean };
  orgChart: OrgChartAudience;
}

/**
 * The fields on a profile, in the order people meet them, with what can't change: names are always required and
 * seen by everyone, work email is always seen, hire date is always required (the server refuses otherwise). Each
 * field's words (`employeeFields.fields.<key>`: its label, "their …" and the plural) are in the catalogue.
 */
const FIELDS: { key: FieldKey; locked: readonly Audience[] }[] = [
  { key: "firstName", locked: ["required", "visibleToEmployee", "visibleToManager"] },
  { key: "lastName", locked: ["required", "visibleToEmployee", "visibleToManager"] },
  { key: "email", locked: ["visibleToEmployee", "visibleToManager"] },
  { key: "hireDate", locked: ["required"] },
  { key: "phone", locked: [] },
  { key: "jobTitle", locked: [] },
  { key: "workLocation", locked: [] },
  { key: "employmentType", locked: [] },
];

const COLUMNS: readonly Audience[] = ["required", "visibleToEmployee", "visibleToManager"];

const SELF_SERVICE = ["canEditPreferredName", "canEditPhone"] as const;

const ORG_CHART_AUDIENCES: readonly OrgChartAudience[] = ["Everyone", "ManagersAndHr"];

export function toDraft(settings: PeopleDataSettingsDto): EmployeeFieldsDraft {
  const fields = Object.fromEntries(
    FIELDS.map((field) => {
      const rule = settings.employeeFieldConfig[field.key];
      return [
        field.key,
        {
          required: rule?.required ?? false,
          visibleToEmployee: rule?.visibleToEmployee ?? true,
          visibleToManager: rule?.visibleToManager ?? true,
        },
      ];
    })
  ) as Record<FieldKey, FieldRule>;
  return { fields, selfService: { ...settings.selfService }, orgChart: settings.orgChart?.audience ?? "Everyone" };
}

/** What saving does, one sentence per change, at most two before "and N more". */
export function employeeFieldsConsequence(saved: EmployeeFieldsDraft, draft: EmployeeFieldsDraft, say: Say = sayInEnglish): string {
  const field = (key: FieldKey, word: "label" | "their" | "plural") => say(`employeeFields.fields.${key}.${word}`);
  const said = (key: string, values: Record<string, string>) => say(`employeeFields.consequence.${key}`, values);
  const sentences: string[] = [];
  for (const { key } of FIELDS) {
    const before = saved.fields[key];
    const after = draft.fields[key];
    if (before.visibleToManager !== after.visibleToManager) {
      sentences.push(said(after.visibleToManager ? "managersSee" : "managersStop", { nouns: field(key, "plural") }));
    }
    if (before.visibleToEmployee !== after.visibleToEmployee) {
      sentences.push(said(after.visibleToEmployee ? "employeesSee" : "employeesStop", { their: field(key, "their") }));
    }
    if (before.required !== after.required) {
      sentences.push(said(after.required ? "required" : "optional", { label: field(key, "label") }));
    }
  }
  for (const option of SELF_SERVICE) {
    if (saved.selfService[option] !== draft.selfService[option]) {
      const their = say(`employeeFields.selfService.${option}.their`);
      sentences.push(said(draft.selfService[option] ? "canChange" : "cannotChange", { their }));
    }
  }
  if (saved.orgChart !== draft.orgChart) sentences.push(say(`employeeFields.consequence.orgChart${draft.orgChart}`));
  if (sentences.length <= 2) return sentences.join(" ");
  return say("employeeFields.consequence.more", { sentences: sentences.slice(0, 2).join(" "), count: sentences.length - 2 });
}

/** Settings › Employee fields: who sees each profile field, and what employees change themselves. */
export function EmployeeFieldsSettings({ section }: { section: FusionSettingsSection }) {
  const say = useSettingsSay();
  const failure = useSaveFailure();
  const title = useSettingsSectionName()(section);
  const fieldLabel = (key: FieldKey) => say(`employeeFields.fields.${key}.label`);
  const columnLabel = (column: Audience) => say(`employeeFields.columns.${column}`);
  const editable = section.access === "manage";
  const query = usePeopleDataSettings();
  const update = useUpdatePeopleDataSettings();
  const saved = useMemo(() => (query.data ? toDraft(query.data) : undefined), [query.data]);
  const { mutateAsync } = update;
  const version = query.data?.version ?? null;
  const save = useCallback(
    (draft: EmployeeFieldsDraft) =>
      mutateAsync({
        expectedVersion: version,
        input: {
          employeeFieldConfig: Object.fromEntries(
            FIELDS.map((field) => [field.key, { visible: true, ...draft.fields[field.key] }])
          ),
          selfService: draft.selfService,
          orgChart: { audience: draft.orgChart },
        },
      }),
    [mutateAsync, version]
  );
  const staged = useStagedSettings(saved, save, {
    onReload: () => void query.refetch(),
    leaveMessage: say("employeeFields.leave"),
  });
  const saver = useSettingsConflictSaver("core", [section.id], staged.conflict);
  const draft = staged.draft;

  if (query.error && !query.data) {
    return (
      <SettingsPage title={title}>
        <PageError title={say("employeeFields.didNotLoad")} onRetry={() => void query.refetch()} />
      </SettingsPage>
    );
  }

  const setRule = (key: FieldKey, audience: Audience, value: boolean) =>
    staged.update((current) => ({
      ...current,
      fields: { ...current.fields, [key]: { ...current.fields[key], [audience]: value } },
    }));

  return (
    <SettingsPage
      title={title}
      lastChange={section.lastChange}
      setUpAt={section.setUpAt}
      viewOnly={!editable}
      loading={!draft}
    >
      {draft ? (
        <>
          <SettingsBlock title={say("employeeFields.onProfile")}>
            <div className="overflow-hidden rounded-surface border border-border bg-card">
              <table className="w-full table-fixed text-sm">
                <thead className="bg-inlay">
                  <tr className="type-meta text-muted-foreground">
                    <th scope="col" className="px-5 py-2.5 text-start font-semibold">{say("employeeFields.field")}</th>
                    {COLUMNS.map((column) => (
                      <th key={column} scope="col" className="w-[128px] px-2 py-2.5 text-center font-semibold">
                        {columnLabel(column)}
                      </th>
                    ))}
                    <th scope="col" className="w-[96px] px-2 py-2.5 text-center font-semibold">{say("employeeFields.hr")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {FIELDS.map((field) => {
                    const rule = draft.fields[field.key];
                    const changed = saved ? JSON.stringify(saved.fields[field.key]) !== JSON.stringify(rule) : false;
                    return (
                      <tr key={field.key} className={cn("h-12", changed && "bg-primary-tint")}>
                        <th scope="row" className="px-5 text-start type-label font-semibold text-foreground">
                          {fieldLabel(field.key)}
                        </th>
                        {COLUMNS.map((column) => {
                          const value = rule[column];
                          return (
                            <td key={column} className="px-2 text-center">
                              {editable ? (
                                <Checkbox
                                  aria-label={say("employeeFields.cell", { field: fieldLabel(field.key), column: columnLabel(column) })}
                                  checked={value}
                                  disabled={field.locked.includes(column)}
                                  onCheckedChange={(next) => setRule(field.key, column, next === true)}
                                />
                              ) : (
                                <span className="text-foreground">
                                  {column === "required"
                                    ? say(value ? "employeeFields.yes" : "employeeFields.no")
                                    : say(value ? "employeeFields.seesIt" : "employeeFields.hidden")}
                                </span>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-2 text-center">
                          {editable ? (
                            <Checkbox aria-label={say("employeeFields.hrAlways", { field: fieldLabel(field.key) })} checked disabled />
                          ) : (
                            <span className="text-foreground">{say("employeeFields.seesIt")}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </SettingsBlock>

          <SettingsBlock title={say("employeeFields.canChange")}>
            <SettingsRows>
              {SELF_SERVICE.map((option) => (
                <SettingsRow
                  key={option}
                  label={say(`employeeFields.selfService.${option}.label`)}
                  htmlFor={editable ? `self-service-${option}` : undefined}
                >
                  {editable ? (
                    <Switch
                      id={`self-service-${option}`}
                      checked={draft.selfService[option]}
                      onCheckedChange={(next) =>
                        staged.update((current) => ({
                          ...current,
                          selfService: { ...current.selfService, [option]: next },
                        }))
                      }
                    />
                  ) : (
                    <SettingsValue>{say(draft.selfService[option] ? "employeeFields.yes" : "employeeFields.no")}</SettingsValue>
                  )}
                </SettingsRow>
              ))}
            </SettingsRows>
          </SettingsBlock>

          <SettingsBlock title={say("employeeFields.orgChart.title")}>
            {editable ? (
              <OptionCards
                columns={2}
                label={say("employeeFields.orgChart.title")}
                value={draft.orgChart}
                onChange={(value) => staged.update((current) => ({ ...current, orgChart: value }))}
                options={ORG_CHART_AUDIENCES.map((audience) => ({
                  value: audience,
                  label: say(`employeeFields.orgChart.${audience}.label`),
                  description: say(`employeeFields.orgChart.${audience}.detail`),
                }))}
              />
            ) : (
              <SettingsRows>
                <SettingsRow
                  label={say(`employeeFields.orgChart.${draft.orgChart}.label`)}
                  description={say(`employeeFields.orgChart.${draft.orgChart}.detail`)}
                />
              </SettingsRows>
            )}
          </SettingsBlock>

          {editable && saved ? (
            <SettingsSaveBar
              changes={staged.changes}
              consequence={employeeFieldsConsequence(saved, draft, say)}
              saving={staged.saving}
              error={failure(staged.error, say("employeeFields.notSaved"))}
              conflict={saver}
              conflictPending={staged.conflict && !saver}
              onDiscard={staged.discard}
              onSave={() => void staged.submit()}
              onReload={staged.reload}
            />
          ) : null}
        </>
      ) : null}
    </SettingsPage>
  );
}
