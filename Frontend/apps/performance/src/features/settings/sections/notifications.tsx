"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import type { FusionSettingsSection, NotificationDefaults } from "@repo/api";
import {
  useNotificationDefaults,
  useSettingsConflictSaver,
  useUpdateNotificationDefaults,
} from "@repo/api/query";
import { useStagedSettings } from "@repo/api/react";
import {
  NotificationModeList,
  PageError,
  SettingsPage,
  SettingsSaveBar,
  useSettingsSectionName,
} from "@repo/ds/shell";
import { useSaveFailure } from "../say";

/**
 * Settings › Notifications: the company's email mode per Performance group (B-002 N7). People's own choices are kept
 * and read against the new modes; the bell is never affected.
 */
export function NotificationsSettings({
  section,
}: {
  section: FusionSettingsSection;
}) {
  const t = useTranslations("ds.settings");
  const failure = useSaveFailure();
  const title = useSettingsSectionName()(section);
  const editable = section.access === "manage";
  const query = useNotificationDefaults("performance");
  const { mutateAsync } = useUpdateNotificationDefaults("performance");
  const version = query.data?.version ?? 0;
  const persist = useCallback(
    (draft: NotificationDefaults) =>
      mutateAsync({
        expectedVersion: version,
        modes: Object.fromEntries(
          draft.groups.map((group) => [group.key, group.mode])
        ),
      }),
    [mutateAsync, version]
  );
  const staged = useStagedSettings(query.data, persist, {
    onReload: () => void query.refetch(),
    leaveMessage: t("notificationModes.leave"),
  });
  const saver = useSettingsConflictSaver(
    "performance",
    [section.id],
    staged.conflict
  );
  const draft = staged.draft;

  if (query.error && !query.data) {
    return (
      <SettingsPage title={title}>
        <PageError
          title={t("didNotLoad")}
          onRetry={() => void query.refetch()}
        />
      </SettingsPage>
    );
  }

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
          <NotificationModeList
            groups={draft.groups}
            editable={editable}
            disabled={staged.saving}
            onChange={(key, mode) =>
              staged.update((current) => ({
                ...current,
                groups: current.groups.map((group) =>
                  group.key === key ? { ...group, mode } : group
                ),
              }))
            }
          />
          {editable && query.data ? (
            <SettingsSaveBar
              changes={staged.changes}
              consequence={t("notificationModes.consequence")}
              saving={staged.saving}
              error={failure(staged.error, t("notificationModes.notSaved"))}
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
