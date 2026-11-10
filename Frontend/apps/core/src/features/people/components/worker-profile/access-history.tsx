"use client";

import { useTranslations } from "next-intl";
import type { WorkforceAccountHistoryEventDto, WorkforceAccountHistoryKind } from "@repo/api";
import { Button, Skeleton, cn } from "@repo/ds";
import { useFormat } from "@repo/ds/lib/use-format";
import { Section } from "@repo/ds/shell";
import { LogIn, MailCheck, MailX, RotateCcw, Send, ShieldCheck, ShieldOff, UserCheck, UserX, type IconComponent } from "@repo/ds/icons";
import { useAccessHistory } from "@/features/workforce-access/api/use-workforce-access";

const ICON: Record<WorkforceAccountHistoryKind, IconComponent> = {
  Invited: Send,
  SentAgain: Send,
  Delivered: MailCheck,
  NotDelivered: MailX,
  Withdrawn: UserX,
  Accepted: UserCheck,
  SignedIn: LogIn,
  RoleGiven: ShieldCheck,
  RoleRemoved: ShieldOff,
};

const TONE: Partial<Record<WorkforceAccountHistoryKind, "ok" | "bad">> = {
  SignedIn: "ok",
  Accepted: "ok",
  NotDelivered: "bad",
  Withdrawn: "bad",
};

/** Person › Access › History (B-231): the account's story, newest first, from Identity's invitations, role grants and sign-in. */
export function AccessHistory({ employeeId, firstName }: { employeeId: string; firstName: string }) {
  const t = useTranslations("profile.accessHistory");
  const history = useAccessHistory(employeeId);
  const events = history.data ?? [];
  return (
    <Section id="profile-access-history" title={t("title")} action={events.length > 0 ? <span className="type-meta text-muted-foreground">{t("newestFirst")}</span> : undefined}>
      {history.isLoading && !history.data ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-2/3" />
        </div>
      ) : history.error && !history.data ? (
        <div className="flex items-center justify-between gap-4 rounded-surface border border-dashed px-5 py-4">
          <p className="type-body text-muted-foreground">{t("unavailable")}</p>
          <Button variant="ghost" size="sm" onClick={() => void history.refetch()}>
            <RotateCcw className="size-4" aria-hidden /> {t("retry")}
          </Button>
        </div>
      ) : events.length === 0 ? (
        <p className="type-body text-muted-foreground">{t("empty")}</p>
      ) : (
        <ol>
          {events.map((event, index) => (
            <HistoryRow key={`${event.kind}-${event.occurredAt}-${index}`} event={event} firstName={firstName} last={index === events.length - 1} />
          ))}
        </ol>
      )}
    </Section>
  );
}

function HistoryRow({ event, firstName, last }: { event: WorkforceAccountHistoryEventDto; firstName: string; last: boolean }) {
  const t = useTranslations("profile.accessHistory");
  const format = useFormat();
  const Icon = ICON[event.kind];
  const tone = TONE[event.kind];
  const at = new Date(event.occurredAt);
  const today = at.toDateString() === new Date().toDateString();
  const when = `${today ? t("today") : format.date(at)}, ${format.time(at)}`;
  const by = event.actorName ?? "";
  const { title, note } = words(event, by, firstName, t, (value) => format.date(value));
  return (
    <li className="flex gap-3">
      <span className="w-28 shrink-0 pt-1 type-meta tabular-nums text-muted-foreground">{when}</span>
      <div className="flex flex-col items-center" aria-hidden>
        <span
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-full",
            tone === "ok" ? "bg-success/15 text-success" : tone === "bad" ? "bg-destructive/15 text-destructive" : "bg-inlay text-muted-foreground"
          )}
        >
          <Icon className="size-3.5" />
        </span>
        {last ? null : <span className="w-px flex-1 bg-border" />}
      </div>
      <div className={cn("min-w-0 pt-1", !last && "pb-5")}>
        <p className="type-label text-foreground">{title}</p>
        {note ? <p className="mt-0.5 type-meta text-muted-foreground">{note}</p> : null}
      </div>
    </li>
  );
}

type Say = ReturnType<typeof useTranslations<"profile.accessHistory">>;

function words(event: WorkforceAccountHistoryEventDto, by: string, firstName: string, t: Say, date: (value: string) => string) {
  const email = event.email ?? "";
  const role = event.roleName ?? "";
  switch (event.kind) {
    case "Invited":
      return { title: by ? t("invitedBy", { name: by }) : t("invited"), note: null };
    case "SentAgain":
      return { title: by ? t("sentAgainBy", { name: by }) : t("sentAgain"), note: null };
    case "Delivered":
      return { title: t("delivered", { email }), note: event.validUntil ? t("validUntil", { date: date(event.validUntil) }) : null };
    case "NotDelivered":
      return { title: t("notDelivered"), note: t("sentTo", { email }) };
    case "Withdrawn":
      return { title: by ? t("withdrawnBy", { name: by }) : t("withdrawn"), note: t("linkStopped") };
    case "Accepted":
      return { title: t("accepted"), note: null };
    case "SignedIn":
      return { title: t("signedIn"), note: t("signedInNote", { name: firstName }) };
    case "RoleGiven":
      return { title: event.byRule ? t("roleByRule", { role }) : by ? t("roleGivenBy", { role, name: by }) : t("roleGiven", { role }), note: null };
    case "RoleRemoved":
      return event.byRule
        ? { title: t("roleRemoved", { role }), note: t("roleRuleEnded") }
        : { title: by ? t("roleRemovedBy", { role, name: by }) : t("roleRemoved", { role }), note: null };
  }
}
