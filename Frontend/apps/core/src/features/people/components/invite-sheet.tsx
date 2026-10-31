"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Button,
  Checkbox,
  DatePicker,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetTitle,
  Skeleton,
  Switch,
  cn,
} from "@repo/ds";
import { OptionCards, Segmented } from "@repo/ds/choice";
import { AsyncButton } from "@repo/ds/shell";
import { useTenantSummary } from "@repo/api/query";
import type { InvitationAudience, ProvisioningSettingsDto } from "@repo/api";
import { toast } from "sonner";
import { Mail, Search, X } from "lucide-react";
import { EmailPreview } from "@/features/settings/brand/brand-previews";
import { useProvisioningSettings, useUpdateProvisioningSettings } from "@/features/settings/api/use-tenant-settings";
import { usePeople } from "../api/use-people";
import { useInvitationMutations, useInvitationPlan } from "../api/use-people-directory";
import { Monogram } from "./workforce-ui";

const TIMES = Array.from({ length: 27 }, (_, index) => {
  const minutes = 7 * 60 + index * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});

/** Next Monday, as `YYYY-MM-DD` in the viewer's own calendar. */
function nextMonday() {
  const day = new Date();
  day.setDate(day.getDate() + ((8 - day.getDay()) % 7 || 7));
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

function Block({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 border-t border-border px-6 py-5 first:border-t-0">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="type-label font-semibold">{title}</h3>
        {meta ? <span className="type-meta text-muted-foreground">{meta}</span> : null}
      </div>
      {children}
    </section>
  );
}

function ChosenPeople({ chosen, onToggle }: { chosen: Map<string, string>; onToggle: (id: string, name: string) => void }) {
  const t = useTranslations("people.invite");
  const [q, setQ] = useState("");
  const people = usePeople({ view: "NotSignedIn", q: q.trim() || null, pageSize: 100 });
  const rows = (people.data?.items ?? []).filter((row) => row.employeeId);
  return (
    <div className="grid gap-2">
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(event) => setQ(event.target.value)} placeholder={t("find")} aria-label={t("find")} className="ps-9" />
      </div>
      <div className="max-h-64 overflow-y-auto rounded-inset bg-inlay p-1">
        {people.isLoading ? (
          <div className="grid gap-2 p-2">{[0, 1, 2].map((index) => <Skeleton key={index} className="h-8" />)}</div>
        ) : rows.length === 0 ? (
          <p className="p-3 type-meta text-muted-foreground">{t("nobody")}</p>
        ) : (
          rows.map((row) => {
            const noEmail = row.signIn?.state === "NoEmail";
            const id = row.employeeId!;
            return (
              <label
                key={row.employeeKey}
                className={cn("flex items-center gap-3 rounded-nested px-2 py-1.5", noEmail ? "opacity-60" : "cursor-pointer hover:bg-foreground/5")}
              >
                <Checkbox checked={chosen.has(id)} disabled={noEmail} onCheckedChange={() => onToggle(id, row.displayName)} />
                <Monogram name={row.displayName} photoUrl={row.photoUrl} size="xs" />
                <span className="min-w-0 flex-1 truncate type-body">{row.displayName}</span>
                {noEmail ? <span className="type-meta text-muted-foreground">{t("noEmail")}</span> : null}
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

/** Invite your people (D-11): who, when, first-day invitations and reminders, and the email as people get it. */
export function InviteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("people.invite");
  const locale = useLocale();
  const plan = useInvitationPlan(open);
  const { send, cancel } = useInvitationMutations();
  const provisioning = useProvisioningSettings(open);
  const updateProvisioning = useUpdateProvisioningSettings();
  const summary = useTenantSummary();
  const [who, setWho] = useState<InvitationAudience>("NotSignedIn");
  const [when, setWhen] = useState<"now" | "later">("now");
  const [date, setDate] = useState(nextMonday);
  const [time, setTime] = useState("09:00");
  const [chosen, setChosen] = useState(() => new Map<string, string>());

  const counts = plan.data;
  const count = who === "NotSignedIn" ? counts?.notSignedIn ?? 0 : who === "Managers" ? counts?.managers ?? 0 : chosen.size;
  const sendAt = when === "later" && date ? new Date(`${date}T${time}:00`) : null;
  const atWords = (value: Date) =>
    new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(value);
  const laterInvalid = when === "later" && (!sendAt || sendAt.getTime() <= Date.now());

  const settings = provisioning.data?.provisioning;
  const saveSetting = async (change: Partial<ProvisioningSettingsDto>) => {
    if (!settings) return;
    try {
      await updateProvisioning.mutateAsync({ expectedVersion: provisioning.data?.version ?? null, input: { provisioning: { ...settings, ...change } } });
    } catch {
      toast.error(t("settingNotSaved"));
    }
  };

  const brand = useMemo(() => {
    const data = summary.data;
    if (!data) return null;
    const language = data.language === "fr" || data.language === "ar" ? data.language : "en";
    return { name: data.name, color: data.brandColor ?? null, language, logoSrc: data.logoUrl ?? null } as const;
  }, [summary.data]);

  const submit = async () => {
    try {
      const result = await send.mutateAsync({
        audience: who,
        employeeIds: who === "Chosen" ? [...chosen.keys()] : null,
        sendAt: sendAt ? sendAt.toISOString() : null,
      });
      if (result.scheduled) toast.success(t("planned", { count: result.scheduled.people, when: atWords(new Date(result.scheduled.sendAt)) }));
      else if (result.notSent > 0) toast.warning(t("sentSome", { count: result.invited + result.linked, failed: result.notSent }));
      else toast.success(t("sent", { count: result.invited + result.linked }));
      setChosen(new Map());
      onClose();
    } catch {
      toast.error(t("failed"));
    }
  };

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent side="right" showCloseButton={false} className="gap-0 p-0 data-[side=right]:w-[520px] data-[side=right]:sm:max-w-[520px]">
        <div className="flex items-center gap-3 border-b border-border px-6 py-4">
          <span className="grid size-9 place-items-center rounded-control bg-primary-tint text-primary-ink"><Mail className="size-4" aria-hidden /></span>
          <SheetTitle className="flex-1 type-section-title">{t("title")}</SheetTitle>
          <Button size="icon-sm" variant="ghost" aria-label={t("close")} onClick={onClose}><X aria-hidden /></Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <Block title={t("who")}>
            {plan.isLoading ? (
              <Skeleton className="h-36" />
            ) : plan.error ? (
              <div className="flex items-center justify-between gap-3">
                <p className="type-body text-muted-foreground">{t("didNotLoad")}</p>
                <Button variant="outline" size="sm" onClick={() => void plan.refetch()}>{t("retry")}</Button>
              </div>
            ) : (
              <>
                <OptionCards
                  label={t("who")}
                  columns={1}
                  value={who}
                  onChange={setWho}
                  options={[
                    { value: "NotSignedIn", label: t("everyone"), description: t("people", { count: counts?.notSignedIn ?? 0 }) },
                    { value: "Managers", label: t("managers"), description: t("people", { count: counts?.managers ?? 0 }), disabled: !counts?.managers },
                    { value: "Chosen", label: t("choose"), description: chosen.size ? t("people", { count: chosen.size }) : undefined },
                  ]}
                />
                {who === "Chosen" ? (
                  <ChosenPeople
                    chosen={chosen}
                    onToggle={(id, name) =>
                      setChosen((current) => {
                        const next = new Map(current);
                        if (next.has(id)) next.delete(id);
                        else next.set(id, name);
                        return next;
                      })
                    }
                  />
                ) : null}
                {counts?.noEmail ? <p className="type-meta text-muted-foreground">{t("withoutEmail", { count: counts.noEmail })}</p> : null}
              </>
            )}
          </Block>

          <Block title={t("when")}>
            <Segmented
              label={t("when")}
              value={when}
              onChange={setWhen}
              options={[{ value: "now", label: t("now") }, { value: "later", label: t("later") }]}
              className="justify-self-start"
            />
            {when === "later" ? (
              <div className="flex flex-wrap items-center gap-2">
                <DatePicker value={date} onChange={setDate} min={new Date().toISOString().slice(0, 10)} aria-label={t("day")} className="w-48" />
                <Select value={time} onValueChange={setTime}>
                  <SelectTrigger className="w-28" aria-label={t("time")}><SelectValue /></SelectTrigger>
                  <SelectContent>{TIMES.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ) : null}
            {counts?.scheduled.length ? (
              <ul className="grid gap-1.5">
                {counts.scheduled.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 rounded-inset bg-inlay px-3 py-2">
                    <span className="min-w-0 flex-1 truncate type-meta">
                      {t("plannedRow", { when: atWords(new Date(item.sendAt)), count: item.people })}
                    </span>
                    <Button size="sm" variant="ghost" disabled={cancel.isLoading} onClick={() => void cancel.mutateAsync(item.id).catch(() => toast.error(t("failed")))}>
                      {t("cancelPlanned")}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </Block>

          <Block title={t("onTheirOwn")}>
            {settings ? (
              <div className="grid gap-3">
                <label className="flex items-center justify-between gap-4">
                  <span className="type-body">
                    {t("firstDay")}
                    {counts?.joinersOnFirstDay ? <span className="ms-2 type-meta text-muted-foreground">{t("people", { count: counts.joinersOnFirstDay })}</span> : null}
                  </span>
                  <Switch
                    checked={settings.inviteJoinersOnFirstDay}
                    disabled={updateProvisioning.isLoading}
                    onCheckedChange={(checked) => void saveSetting({ inviteJoinersOnFirstDay: checked })}
                  />
                </label>
                <label className="flex items-center justify-between gap-4">
                  <span className="type-body">{t("remind", { count: settings.remindAfterDays || 3 })}</span>
                  <Switch
                    checked={settings.remindAfterDays > 0}
                    disabled={updateProvisioning.isLoading}
                    onCheckedChange={(checked) => void saveSetting({ remindAfterDays: checked ? 3 : 0 })}
                  />
                </label>
              </div>
            ) : (
              <Skeleton className="h-16" />
            )}
          </Block>

          <Block title={t("email")} meta={t("inTheirLanguage")}>
            {brand ? (
              <div className="overflow-hidden rounded-inset bg-inlay p-3">
                <EmailPreview draft={brand} label={t("email")} failedLabel={t("emailFailed")} />
              </div>
            ) : (
              <Skeleton className="h-56" />
            )}
          </Block>
        </div>

        <div className="flex items-center gap-2 border-t border-border px-6 py-4">
          <span className="flex-1 type-meta text-muted-foreground">
            {when === "now" ? t("sendsNow") : sendAt && !laterInvalid ? t("sendsAt", { when: atWords(sendAt) }) : t("pickLater")}
          </span>
          <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
          <AsyncButton pending={send.isLoading} disabled={count === 0 || laterInvalid || !counts} onClick={() => void submit()}>
            {!counts ? t("sendPlain") : who === "Chosen" && count === 0 ? t("choosePeople") : when === "now" ? t("send", { count }) : t("plan", { count })}
          </AsyncButton>
        </div>
      </SheetContent>
    </Sheet>
  );
}
