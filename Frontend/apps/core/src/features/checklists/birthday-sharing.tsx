"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Switch } from "@repo/ds";
import { Section } from "@repo/ds/shell";
import { useRefusal } from "@/i18n/words";
import { useBirthdaySharing, useSetBirthdaySharing } from "./use-checklists";

/**
 * The person's own choice to let the people around them see their birthday in Coming up (B-184): the day and month,
 * never the year. Off until they turn it on; only shown once a date of birth is recorded.
 */
export function BirthdaySharing() {
  const t = useTranslations("checklists.birthday");
  const refusal = useRefusal();
  const query = useBirthdaySharing(true);
  const update = useSetBirthdaySharing();
  if (!query.data?.hasDate) return null;

  async function toggle(share: boolean) {
    try {
      await update.mutateAsync(share);
      toast.success(t(share ? "shared" : "hidden"));
    } catch (caught) {
      toast.error(refusal(caught, t("didNotSave")));
    }
  }

  return (
    <Section title={t("title")}>
      <div className="flex items-center justify-between gap-4">
        <label htmlFor="share-birthday" className="type-body">{t("label")}</label>
        <Switch id="share-birthday" checked={query.data.share} disabled={update.isLoading} onCheckedChange={(on) => void toggle(on)} />
      </div>
    </Section>
  );
}
