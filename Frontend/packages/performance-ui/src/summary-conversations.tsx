import type { PersonSummaryFeedbackDto, PersonSummaryOneOnOneDto, PersonSummaryPraiseDto, PraiseDto, PraiseReactionKind } from "@repo/api";
import { Section, StatusBadge } from "@repo/ds/shell";
import { cn } from "@repo/ds";
import { PraiseList, initials, type PraiseReactionIcons } from "./praise";
import type { RenderSummaryLink } from "./summary-lib";
import { Avatar, AvatarFallback } from "@repo/ds/components/ui/avatar";
import { useTranslations } from "next-intl";
import { usePerformanceWords } from "./use-words";

const linkClass = "type-label text-foreground hover:underline";

/** The person's next 1:1 with the viewer; the server only sends it to the two people. */
export function SummaryOneOnOne({ oneOnOne, renderLink }: { oneOnOne: PersonSummaryOneOnOneDto; renderLink: RenderSummaryLink }) {
  const t = useTranslations("performanceUi.SummaryOneOnOne");
  const words = usePerformanceWords();
  const next = oneOnOne.nextMeetingAt ? new Date(oneOnOne.nextMeetingAt) : null;
  // The series' next meeting stays next until it's completed: once its day has passed, it's overdue.
  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0));
  const overdue = next !== null && next < startOfToday;
  return (
    <section aria-label="1:1" className="flex flex-wrap items-center justify-between gap-3 rounded-surface bg-card px-5 py-4">
      <div className="min-w-0">
        <p className={cn("type-meta", overdue ? "text-destructive" : "text-muted-foreground")}>{overdue ? words.t("overdue11") : t("next11")}</p>
        <p className="type-body text-foreground">
          {next
            ? words.dateTime(next)
            : t("notScheduled")}
        </p>
      </div>
      {renderLink({ href: oneOnOne.href, className: linkClass, children: words.t("open11s") })}
    </section>
  );
}

/** Feedback the person received, as the viewer may see it; manager-only items are marked. */
export function SummaryFeedback({ feedback, renderLink }: { feedback: PersonSummaryFeedbackDto; renderLink: RenderSummaryLink }) {
  const t = useTranslations("performanceUi.SummaryFeedback");
  const words = usePerformanceWords();
  return (
    <Section
      id="summary-feedback"
      title={t("feedback")}
      meta={feedback.total > 0 ? feedback.total : undefined}
      flush={feedback.items.length > 0}
      action={feedback.total > 0 ? renderLink({ href: feedback.href, className: linkClass, children: words.t("openFeedback") }) : null}
    >
      {feedback.items.length === 0 ? (
        <p className="type-body-secondary text-muted-foreground">{t("noFeedbackYet")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {feedback.items.map((item) => (
            <li key={item.id} className="flex items-start gap-3 px-5 py-4">
              <Avatar className="size-8">
                <AvatarFallback className="text-[0.65rem] font-medium">{initials(item.author.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="type-label text-foreground">{item.author.name ?? t("aColleague")}</span>
                  {item.subject ? (
                    <span className="rounded-control bg-inlay px-2 py-0.5 type-meta text-foreground">{item.subject.label}</span>
                  ) : null}
                  {item.visibility === "ManagerOnly" ? <StatusBadge tone="neutral">{t("managerOnly")}</StatusBadge> : null}
                  <span className="type-meta text-muted-foreground">{words.date(item.sentAt)}</span>
                </div>
                <p dir="auto" className="type-body line-clamp-2 text-foreground">{item.message}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export interface SummaryPraiseProps {
  praise: PersonSummaryPraiseDto;
  renderLink: RenderSummaryLink;
  reactionIcons: PraiseReactionIcons;
  onReact?: (praise: PraiseDto, kind: PraiseReactionKind, add: boolean) => void;
  onOpen?: (praise: PraiseDto) => void;
}

/** Praise the person received: everyone in Performance sees it. */
export function SummaryPraise({ praise, renderLink, reactionIcons, onReact, onOpen }: SummaryPraiseProps) {
  const t = useTranslations("performanceUi.SummaryPraise");
  const words = usePerformanceWords();
  return (
    <Section
      id="summary-praise"
      title={t("praise")}
      meta={praise.total > 0 ? praise.total : undefined}
      action={praise.total > praise.items.length ? renderLink({ href: praise.href, className: linkClass, children: words.t("seeAllPraise") }) : null}
    >
      <PraiseList
        quote
        items={praise.items}
        reactionIcons={reactionIcons}
        onReact={onReact}
        onOpen={onOpen}
        empty={<p className="type-body-secondary text-muted-foreground">{t("noPraiseYet")}</p>}
      />
    </Section>
  );
}


