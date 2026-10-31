"use client";

import { useState } from "react";
import { Check, ChevronRight, Lock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, type FusionSettingsModuleKey, type NotificationGroupKey, type NotificationPreferenceGroup } from "@repo/api";
import { useNotificationPreferences, useUpdateNotificationPreferences } from "@repo/api/query";
import { useNotificationAlerts, type NotificationAlerts } from "@repo/auth";
import { Button, cn, Switch } from "@repo/ds";
import {
  FUSION_MODULE_ICONS,
  PageError,
  playChime,
  SettingsBlock,
  SettingsPage,
  SettingsRow,
  SettingsRows,
  SettingsSaved,
} from "@repo/ds/shell";

/**
 * Each module serves its groups and lines from a fixed English catalogue with no codes for the lines (Performance's
 * NotificationPreferenceCatalog, Core HR's notification feed). The screen names them from its own catalogue: groups by
 * key, summaries and lines by the server's English. Anything the catalogue doesn't know yet is shown as the server sent it.
 */
const SUMMARIES: Record<string, string> = {
  "Your plan approved or returned, updates asked of you, development goals added": "plansAndGoals",
  "Plans waiting for your decision, your plan approved or returned, objectives at risk on your team": "plansAndGoalsLeader",
  "Your self-assessment opens, peer input asked of you, your review released": "reviews",
  "Reviews to write, peers to approve, your own review": "reviewsLeader",
  "A 1:1 started or moved, actions assigned to you": "oneOnOnes",
  "Feedback and praise you receive, requests for your feedback": "feedback",
  "Feedback and praise for you and your team, requests and answers": "feedbackLeader",
  "Something of yours is due soon or late": "deadlines",
  "Your manager, your job, your team": "teamAndJob",
};

const LINES: Record<string, string> = {
  "A review of yours is due tomorrow or late": "reminder",
  "Plans waiting for your decision": "plansWaiting",
  "Objectives at risk on your team": "objectivesAtRisk",
  "Answers to the updates you asked for": "updateAnswers",
  "Your plan approved or returned": "planApprovedOrReturned",
  "Updates asked of you": "updatesAsked",
  "Development goals added to your plan": "developmentGoals",
  "A review to write opens": "reviewToWrite",
  "Someone submitted their self-assessment": "selfAssessmentSubmitted",
  "Peers to approve": "peersToApprove",
  "Someone acknowledged their review": "reviewAcknowledged",
  "Calibration ready, calibration finalized": "calibration",
  "Your self-assessment opens, your peers approved, your review released": "ownReview",
  "Peer input asked of you, a peer declined, a due date moved": "peerInput",
  "A 1:1 started or moved": "oneOnOneMoved",
  "Actions assigned to you": "actionsAssigned",
  "Feedback and praise for your team": "teamFeedback",
  "Feedback and praise you receive": "feedbackReceived",
  "Requests for your feedback": "feedbackRequests",
  "Answers to your requests": "requestAnswers",
  "Your manager changes": "managerChanges",
  "A change to your job": "jobChange",
  "Someone joins or leaves your team": "teamChanges",
};

type NotificationsT = ReturnType<typeof useTranslations<"settings.notifications">>;

/** A catalogue line when the server's words are known, else the words as sent. */
function known(t: NotificationsT, group: "groups" | "summaries" | "lines", key: string | undefined, sent: string): string {
  const path = `${group}.${key}` as Parameters<NotificationsT>[0];
  return key && t.has(path) ? t(path) : sent;
}

function Always() {
  const t = useTranslations("settings.notifications");
  return (
    <span className="inline-flex items-center gap-1.5 type-meta font-semibold text-muted-foreground">
      <Lock aria-hidden className="size-3.5" />
      {t("always")}
    </span>
  );
}

function GroupRow({
  group,
  saving,
  onEmailChange,
}: {
  group: NotificationPreferenceGroup;
  saving: boolean;
  onEmailChange: (email: boolean) => void;
}) {
  const t = useTranslations("settings.notifications");
  const [open, setOpen] = useState(false);
  const panelId = `notification-group-${group.key}`;
  const label = known(t, "groups", group.key, group.label);
  return (
    <li className="border-b border-border last:border-b-0">
      <div className="grid grid-cols-[minmax(0,1fr)_96px_104px] items-center gap-4 px-5 py-3.5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 items-start gap-2.5 rounded-control text-start outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight
            aria-hidden
            className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-150", open && "rotate-90")}
          />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="type-label font-semibold text-foreground">{label}</span>
            <span className="type-meta text-muted-foreground">
              {open ? t("count", { count: group.count }) : known(t, "summaries", SUMMARIES[group.summary], group.summary)}
            </span>
          </span>
        </button>
        <span className="flex justify-center">
          <Check aria-label={t("alwaysInFusion")} className="size-4 text-muted-foreground" />
        </span>
        <span className="flex justify-center">
          {group.locked ? (
            <Always />
          ) : (
            <Switch
              aria-label={t("emailFor", { group: label })}
              checked={group.email}
              disabled={saving}
              onCheckedChange={onEmailChange}
            />
          )}
        </span>
      </div>
      {open ? (
        <ul id={panelId} className="flex flex-col gap-1 px-5 pb-4 ps-[46px]">
          {group.items.map((item) => (
            <li key={item.label} className="grid grid-cols-[minmax(0,1fr)_104px] items-center gap-4 py-1.5">
              <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-foreground/90">
                {known(t, "lines", LINES[item.label], item.label)}
                {item.team ? (
                  <span className="rounded-control bg-inlay px-1.5 py-0.5 type-meta text-muted-foreground">{t("yourTeam")}</span>
                ) : null}
              </span>
              <span className="flex justify-center">{item.always && !group.locked ? <Always /> : null}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * How a new notification shows up while Fusion is open: a pop-up, and a chime with it. Both live on the account, so
 * they follow the person to every device; each saves the moment it changes.
 */
function Alerts({ onSaved, onFailed }: { onSaved: () => void; onFailed: () => void }) {
  const t = useTranslations("settings.notifications.alerts");
  const { alerts, save, saving } = useNotificationAlerts();
  const change = (next: Partial<NotificationAlerts>) => {
    save(next).then(onSaved, onFailed);
  };
  return (
    <SettingsRows>
      <SettingsRow label={t("popups")} description={t("popupsDescription")}>
        <Switch aria-label={t("popups")} checked={alerts.popups} disabled={saving} onCheckedChange={(popups) => change({ popups })} />
      </SettingsRow>
      <SettingsRow label={t("sound")} description={t("soundDescription")}>
        <Button variant="ghost" size="sm" onClick={playChime}>
          {t("play")}
        </Button>
        <Switch aria-label={t("sound")} checked={alerts.sound} disabled={saving} onCheckedChange={(sound) => change({ sound })} />
      </SettingsRow>
    </SettingsRows>
  );
}

/** The modules that tell people things, in the order the screen lists them. */
const MODULES: { key: FusionSettingsModuleKey; label: string }[] = [
  { key: "performance", label: "Performance" },
  { key: "core", label: "Core HR" },
];

/** One module's groups: what it tells the person, always in Fusion, and by email per group. */
function ModuleNotifications({
  module,
  label,
  preferences,
  onSaved,
}: {
  module: FusionSettingsModuleKey;
  label: string;
  preferences: ReturnType<typeof useNotificationPreferences>;
  onSaved: () => void;
}) {
  const t = useTranslations("settings.notifications");
  const update = useUpdateNotificationPreferences(module);
  const [failed, setFailed] = useState(false);
  const data = preferences.data;
  if (!data) return null;

  const changeEmail = (key: NotificationGroupKey, email: boolean) => {
    const emailOff = data.groups
      .filter((group) => !group.locked && (group.key === key ? !email : !group.email))
      .map((group) => group.key);
    setFailed(false);
    update.mutate(
      { expectedVersion: data.version, emailOff },
      {
        onSuccess: onSaved,
        onError: () => {
          setFailed(true);
          void preferences.refetch();
        },
      },
    );
  };

  const Icon = FUSION_MODULE_ICONS[module];
  return (
    <SettingsBlock
      title={
        <span className="flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-detail bg-primary-tint text-primary-ink">
            {Icon ? <Icon aria-hidden className="size-4" /> : null}
          </span>
          {label}
        </span>
      }
    >
      {failed ? (
        <p role="alert" className="type-meta text-destructive">
          {t("notSaved")}
        </p>
      ) : null}
      <div className="-mx-5 -mb-5 overflow-hidden border-t border-border">
        <div className="grid grid-cols-[minmax(0,1fr)_96px_104px] gap-4 border-b border-border bg-inlay px-5 py-2.5 type-meta font-semibold text-muted-foreground">
          <span>{t("about")}</span>
          <span className="text-center">{t("inFusion")}</span>
          <span className="text-center">{t("email")}</span>
        </div>
        <ul>
          {data.groups.map((group) => (
            <GroupRow
              key={group.key}
              group={group}
              saving={update.isPending}
              onEmailChange={(email) => changeEmail(group.key, email)}
            />
          ))}
        </ul>
      </div>
    </SettingsBlock>
  );
}

const isUnavailable = (error: unknown) => error instanceof ApiError && error.status === 403;

/**
 * Settings › Notifications: pop-ups and their chime, then what each module tells the person, always in Fusion, and by
 * email per group. A module that tells the person nothing (403) shows no block. Groups the company requires show a lock.
 * Each choice saves the moment it changes.
 */
export function Notifications() {
  const t = useTranslations("settings.notifications");
  const locale = useLocale();
  const performance = useNotificationPreferences("performance");
  const core = useNotificationPreferences("core");
  const byModule = { performance, core };
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [alertsFailed, setAlertsFailed] = useState(false);
  const saved = () => {
    setAlertsFailed(false);
    setSavedAt(Date.now());
  };

  const queries = MODULES.map((module) => byModule[module.key]);
  const broken = queries.find((query) => query.isError && !isUnavailable(query.error));
  if (broken) {
    return (
      <div lang={locale} className="contents">
        <SettingsPage title={t("title")}>
          <PageError title={t("didNotLoad")} onRetry={() => void broken.refetch()} />
        </SettingsPage>
      </div>
    );
  }

  const loading = queries.some((query) => query.isPending && !isUnavailable(query.error));
  const none = queries.every((query) => isUnavailable(query.error) || !query.data);
  const emailAddress = queries.map((query) => query.data?.emailAddress).find(Boolean);
  return (
    <div lang={locale} className="contents">
      <SettingsPage title={t("title")} loading={loading} aside={<SettingsSaved at={savedAt} />}>
        {emailAddress ? (
          <p className="-mt-6 type-meta text-muted-foreground">
            {t.rich("emailGoesTo", {
              address: emailAddress,
              b: (chunks) => <span className="font-semibold text-foreground">{chunks}</span>,
            })}
          </p>
        ) : null}
        {alertsFailed ? (
          <p role="alert" className="type-meta text-destructive">
            {t("notSaved")}
          </p>
        ) : null}
        <Alerts onSaved={saved} onFailed={() => setAlertsFailed(true)} />
        {none ? <p className="type-body-secondary text-muted-foreground">{t("none")}</p> : null}
        {MODULES.map((module) => (
          <ModuleNotifications
            key={module.key}
            module={module.key}
            label={module.label}
            preferences={byModule[module.key]}
            onSaved={saved}
          />
        ))}
      </SettingsPage>
    </div>
  );
}
