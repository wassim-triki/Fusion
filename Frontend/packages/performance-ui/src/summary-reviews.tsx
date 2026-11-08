import type { PersonSummaryReviewsDto } from "@repo/api";
import { Section } from "@repo/ds/shell";
import type { RenderSummaryLink } from "./summary-lib";
import { useTranslations } from "next-intl";
import { usePerformanceWords } from "./use-words";

/** The open review, then released results across cycles, newest first. Each opens the review. */
export function SummaryReviews({ reviews, renderLink }: { reviews: PersonSummaryReviewsDto; renderLink: RenderSummaryLink }) {
  const t = useTranslations("performanceUi.SummaryReviews");
  const words = usePerformanceWords();
  const current = reviews.current;
  const rows = [
    ...(current
      ? [
          {
            id: current.reviewId,
            href: current.href,
            title: current.reviewRoundName,
            detail: current.dueDate ? t("due", { dueDate: words.date(current.dueDate) }) : t("inProgress"),
            outcome: current.state === "Closed" ? words.t("closed") : words.step(current.state),
            current: true,
          },
        ]
      : []),
    ...reviews.history.map((result) => ({
      id: result.reviewId,
      href: result.href,
      title: `${result.reviewRoundName}, ${result.cycleName}`,
      detail: result.finalizedAt ? t("finalized", { finalizedAt: words.date(result.finalizedAt) }) : t("finalized2"),
      outcome: result.finalRatingLabel ?? words.t("noRating"),
      current: false,
    })),
  ];

  return (
    <Section id="summary-reviews" title={t("reviews")} flush={rows.length > 0}>
      {rows.length === 0 ? (
        <p className="type-body-secondary text-muted-foreground">{t("noReviewsYet")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id}>
              {renderLink({
                href: row.href,
                className: "group flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-muted",
                children: (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate type-body font-medium text-foreground group-hover:underline">{row.title}</span>
                      <span className="block truncate type-meta text-muted-foreground">{row.detail}</span>
                    </span>
                    <span className={row.current ? "shrink-0 type-label text-primary-ink" : "shrink-0 type-label text-foreground"}>
                      {row.outcome}
                    </span>
                  </>
                ),
              })}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
