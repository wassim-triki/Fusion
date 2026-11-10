// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ObjectiveStatusBadge } from "@repo/performance-ui";
import { renderInFrench, sayInFrench } from "@/test/intl";
import { NotStartedBadge } from "@/features/performance/components/plan/plan-header";
import { planChecks } from "@/features/performance/components/plan/plan-lib";
import { groupLabel } from "@/features/performance/components/team/your-people";
import { dueIn } from "@/features/performance/components/reviews/review-parts";


describe("Performance in French", () => {
  it("says where the year stands in French", () => {
    const say = sayInFrench("year.NextStep");
    expect(sayInFrench("year.phase")("ResultsOut")).toBe("Résultats publiés");
    expect(say("plansNotForward", { count: 3 })).toBe("3 personnes n’ont pas soumis de plan");
    expect(say("nudgedToast", { count: 1 })).toBe("1 personne relancée");
  });

  it("words plan checks, roster groups and review due dates in French", () => {
    const checks = planChecks({ objectiveCount: 0, weightTotal: 0, weightRemaining: 100, everyObjectiveHasWeight: false, openChangeRequests: 0 } as never, sayInFrench("plan.checks"));
    expect(checks[0]!.label).toBe("Le plan contient au moins un objectif");
    expect(groupLabel("Planning", "waiting", sayInFrench("team.people"))).toBe("En attente de vous");
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(dueIn(today, sayInFrench("reviews.parts"))).toBe("échéance aujourd’hui");
  });

  it("renders a plan badge and a shared status badge in French", () => {
    renderInFrench(
      <>
        <NotStartedBadge />
        <ObjectiveStatusBadge status="OnTrack" />
      </>,
    );
    expect(screen.getByText("Non commencé")).toBeInTheDocument();
    expect(screen.getByText("En bonne voie")).toBeInTheDocument();
  });
});
