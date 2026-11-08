import type { DevelopmentGoalStatus, PersonSummaryDevelopmentDto } from "@repo/api";
import { cn } from "@repo/ds";
import { Section } from "@repo/ds/shell";
import type { RenderSummaryLink } from "./summary-lib";
import { useTranslations } from "next-intl";
import { usePerformanceWords } from "./use-words";

/**
 * The person's growth goals for the cycle, each with its status and, while open, when it's aimed for.
 * The mark carries the status by shape and colour: an empty ring, a half-filled ring, a filled check.
 */
export function SummaryDevelopment({ development, renderLink }: { development: PersonSummaryDevelopmentDto; renderLink: RenderSummaryLink }) {
  const t = useTranslations("performanceUi.SummaryDevelopment");
  const words = usePerformanceWords();
  return (
    <Section
      id="summary-development"
      title={t("development")}
      meta={development.goals.length > 0 ? development.goals.length : undefined}
      flush={development.goals.length > 0}
      action={renderLink({ href: development.href, className: "type-label text-foreground hover:underline", children: words.t("openDevelopment") })}
    >
      {development.goals.length === 0 ? (
        <p className="type-body-secondary text-muted-foreground">{t("noDevelopmentGoalsYet")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {development.goals.map((goal, index) => (
            <li key={`${goal.title}-${index}`} className="flex items-start gap-3 px-5 py-3.5">
              <GoalMark status={goal.status} />
              <div className="min-w-0">
                <p className="type-body font-medium text-foreground">{goal.title}</p>
                <p className="type-meta text-muted-foreground">
                  {[
                    words.developmentStatus(goal.status),
                    goal.competencyName,
                    goal.targetDate && goal.status !== "Done" ? t("by", { targetDate: words.date(goal.targetDate) }) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function GoalMark({ status }: { status: DevelopmentGoalStatus }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2",
        status === "Done" && "border-success bg-success text-background",
        status === "InProgress" && "border-primary bg-[linear-gradient(90deg,var(--primary)_50%,transparent_50%)]",
        status === "NotStarted" && "border-muted-foreground/40",
      )}
    >
      {status === "Done" ? (
        <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2.5 6.5l2.2 2.2 4.8-5" />
        </svg>
      ) : null}
    </span>
  );
}
