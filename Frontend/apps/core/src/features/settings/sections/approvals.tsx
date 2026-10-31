"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CHANGE_APPROVAL_TYPES, type ChangeApprovalType, type FusionSettingsSection } from "@repo/api";
import { PersonAvatar, Switch } from "@repo/ds";
import { PageError, SettingsBlock, SettingsPage, SettingsRow, SettingsRows, useSettingsSectionName } from "@repo/ds/shell";
import { useRefusal } from "@/i18n/words";
import { useApprovalSettings, useUpdateApprovals } from "@/features/people/changes/use-changes";

/**
 * Settings › Changes and approvals (B-179): which changes wait for whoever approves, off until the company turns one
 * on. HR's own changes never wait; who approves is a role (Roles › Approving changes).
 */
export function ApprovalsSettings({ section }: { section: FusionSettingsSection }) {
  const t = useTranslations("changes.approvals");
  const ds = useTranslations("ds.settings");
  const refusal = useRefusal();
  const title = useSettingsSectionName()(section);
  const editable = section.access === "manage";
  const query = useApprovalSettings();
  const update = useUpdateApprovals();

  if (query.error && !query.data) {
    return <SettingsPage title={title}><PageError title={ds("didNotLoad")} onRetry={() => void query.refetch()} /></SettingsPage>;
  }
  if (!query.data) return <SettingsPage title={title} loading />;

  const required = new Set(query.data.types.filter((type) => type.required).map((type) => type.type));
  const toggle = async (type: ChangeApprovalType, on: boolean) => {
    const next = CHANGE_APPROVAL_TYPES.filter((item) => (item === type ? on : required.has(item)));
    try {
      await update.mutateAsync(next);
      toast.success(t("saved"));
    } catch (caught) {
      toast.error(refusal(caught, t("failed")));
    }
  };

  return (
    <SettingsPage title={title} lastChange={section.lastChange} setUpAt={section.setUpAt} viewOnly={!editable}>
      <SettingsRows>
        {CHANGE_APPROVAL_TYPES.map((type) => (
          <SettingsRow key={type} htmlFor={`approve-${type}`} label={t(`type.${type}`)} description={required.has(type) ? t("waits") : t("applies")}>
            <Switch id={`approve-${type}`} checked={required.has(type)} disabled={!editable || update.isLoading}
              onCheckedChange={(on) => void toggle(type, on)} />
          </SettingsRow>
        ))}
      </SettingsRows>

      <SettingsBlock title={t("who")} action={<Link href="/settings/roles" className="type-meta font-semibold text-muted-foreground hover:text-foreground">{t("roles")}</Link>}>
        {query.data.approvers.length ? (
          <ul className="flex flex-wrap gap-2">
            {query.data.approvers.map((approver, index) => (
              <li key={`${approver.displayName}-${index}`} className="flex h-10 items-center gap-2 rounded-full bg-inlay ps-1 pe-3.5">
                <PersonAvatar name={approver.displayName} className="size-8 text-xs" />
                <span className="type-label">{approver.displayName}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="type-body text-muted-foreground">{t("nobody")}</p>
        )}
      </SettingsBlock>
    </SettingsPage>
  );
}
