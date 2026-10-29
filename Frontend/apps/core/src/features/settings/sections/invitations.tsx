"use client";

import { useCallback, useMemo } from "react";
import type { FusionSettingsSection, ProvisioningSettingsDto } from "@repo/api";
import { useSettingsConflictSaver } from "@repo/api/query";
import { useStagedSettings } from "@repo/api/react";
import { Input, NativeSelect, NativeSelectOption } from "@repo/ds";
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
import { useAccessProfiles } from "@/features/settings/api/use-core-access";
import {
  useProvisioningSettings,
  useUpdateProvisioningSettings,
} from "@/features/settings/api/use-tenant-settings";
import { sayInEnglish, useSaveFailure, useSettingsSay, type Say } from "@/features/settings/say";

/** Each choice's words are `invitations.reinvite.<value>` in the catalogue. */
const REINVITE = ["RefreshExisting", "KeepExisting"] as const;

/** The built-in role new accounts get when none is chosen: a role's name, as the tenant's data holds it. */
const DEFAULT_ROLE = "Employee";

/** What saving does, from what changed. `roleName` is null while the chosen role isn't known. */
export function invitationsConsequence(
  saved: ProvisioningSettingsDto,
  draft: ProvisioningSettingsDto,
  roleName: string | null,
  say: Say = sayInEnglish
): string {
  const said = (key: string, values?: Record<string, string | number>) => say(`invitations.consequence.${key}`, values);
  const sentences: string[] = [];
  if (saved.inviteExpiryDays !== draft.inviteExpiryDays) sentences.push(said("expiry", { count: draft.inviteExpiryDays }));
  if (saved.resendCooldownHours !== draft.resendCooldownHours) sentences.push(said("cooldown", { count: draft.resendCooldownHours }));
  if (saved.defaultAccessProfileId !== draft.defaultAccessProfileId)
    sentences.push(roleName ? said("role", { role: roleName }) : said("chosenRole"));
  if (saved.pendingInviteBehavior !== draft.pendingInviteBehavior)
    sentences.push(said(draft.pendingInviteBehavior === "KeepExisting" ? "keep" : "fresh"));
  return sentences.join(" ");
}

function NumberField({
  id,
  label,
  value,
  unit,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <>
      <Input
        id={id}
        aria-label={label}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : ""}
        onChange={(event) => onChange(event.target.valueAsNumber)}
        className="h-9 w-16 text-center font-semibold tabular-nums"
      />
      <span className="w-10 type-meta text-muted-foreground">{unit}</span>
    </>
  );
}

/** Settings › Invitations: how Fusion invites new people. */
export function InvitationsSettings({ section }: { section: FusionSettingsSection }) {
  const say = useSettingsSay();
  const failure = useSaveFailure();
  const title = useSettingsSectionName()(section);
  const editable = section.access === "manage";
  const query = useProvisioningSettings();
  const profiles = useAccessProfiles();
  const update = useUpdateProvisioningSettings();
  const saved = query.data?.provisioning;
  const version = query.data?.version ?? null;
  const { mutateAsync } = update;
  const save = useCallback(
    (draft: ProvisioningSettingsDto) => mutateAsync({ expectedVersion: version, input: { provisioning: draft } }),
    [mutateAsync, version]
  );
  const staged = useStagedSettings(saved, save, {
    onReload: () => void query.refetch(),
    leaveMessage: say("invitations.leave"),
  });
  const saver = useSettingsConflictSaver("core", [section.id], staged.conflict);
  const draft = staged.draft;

  const roleName = useCallback(
    (id: string | null) => (id ? profiles.data?.find((profile) => profile.id === id)?.name ?? null : DEFAULT_ROLE),
    [profiles.data]
  );
  const roles = useMemo(() => profiles.data ?? [], [profiles.data]);

  if (query.error && !query.data) {
    return (
      <SettingsPage title={title}>
        <PageError title={say("invitations.didNotLoad")} onRetry={() => void query.refetch()} />
      </SettingsPage>
    );
  }

  const set = (change: Partial<ProvisioningSettingsDto>) => staged.update((current) => ({ ...current, ...change }));

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
          <SettingsRows>
            <SettingsRow label={say("invitations.expiresAfter")} htmlFor={editable ? "invite-expiry" : undefined}>
              {editable ? (
                <NumberField
                  id="invite-expiry"
                  label={say("invitations.expiresAfterInDays")}
                  value={draft.inviteExpiryDays}
                  unit={say("invitations.days")}
                  min={1}
                  max={90}
                  onChange={(value) => set({ inviteExpiryDays: value })}
                />
              ) : (
                <SettingsValue>{say("invitations.dayCount", { count: draft.inviteExpiryDays })}</SettingsValue>
              )}
            </SettingsRow>
            <SettingsRow label={say("invitations.cooldown")} htmlFor={editable ? "invite-cooldown" : undefined}>
              {editable ? (
                <NumberField
                  id="invite-cooldown"
                  label={say("invitations.cooldownInHours")}
                  value={draft.resendCooldownHours}
                  unit={say("invitations.hours")}
                  min={0}
                  max={720}
                  onChange={(value) => set({ resendCooldownHours: value })}
                />
              ) : (
                <SettingsValue>{say("invitations.hourCount", { count: draft.resendCooldownHours })}</SettingsValue>
              )}
            </SettingsRow>
            <SettingsRow label={say("invitations.role")} htmlFor={editable ? "invite-role" : undefined}>
              {editable ? (
                <NativeSelect
                  id="invite-role"
                  value={draft.defaultAccessProfileId ?? ""}
                  onChange={(event) => set({ defaultAccessProfileId: event.target.value || null })}
                  className="w-48"
                >
                  <NativeSelectOption value="">{DEFAULT_ROLE}</NativeSelectOption>
                  {roles
                    .filter((role) => role.name !== DEFAULT_ROLE)
                    .map((role) => (
                      <NativeSelectOption key={role.id} value={role.id}>
                        {role.name}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
              ) : (
                <SettingsValue>{roleName(draft.defaultAccessProfileId) ?? "–"}</SettingsValue>
              )}
            </SettingsRow>
          </SettingsRows>

          <SettingsBlock title={say("invitations.reinviteTitle")}>
            {editable ? (
              <OptionCards
                columns={2}
                label={say("invitations.reinviteTitle")}
                value={draft.pendingInviteBehavior}
                onChange={(value) => set({ pendingInviteBehavior: value })}
                options={REINVITE.map((option) => ({
                  value: option,
                  label: say(`invitations.reinvite.${option}.label`),
                  description: say(`invitations.reinvite.${option}.detail`),
                }))}
              />
            ) : (
              <SettingsRows>
                {(REINVITE as readonly string[]).includes(draft.pendingInviteBehavior) ? (
                  <SettingsRow
                    label={say(`invitations.reinvite.${draft.pendingInviteBehavior}.label`)}
                    description={say(`invitations.reinvite.${draft.pendingInviteBehavior}.detail`)}
                  />
                ) : (
                  <SettingsRow label={draft.pendingInviteBehavior} />
                )}
              </SettingsRows>
            )}
          </SettingsBlock>

          {editable && saved ? (
            <SettingsSaveBar
              changes={staged.changes}
              consequence={invitationsConsequence(saved, draft, roleName(draft.defaultAccessProfileId), say)}
              saving={staged.saving}
              error={failure(staged.error, say("invitations.notSaved"))}
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
