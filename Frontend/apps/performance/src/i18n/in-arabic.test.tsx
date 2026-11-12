// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ObjectiveStatusBadge } from "@repo/performance-ui";
import { renderInArabic, sayInArabic } from "@/test/intl";
import { NotStartedBadge } from "@/features/performance/components/plan/plan-header";
import { planChecks } from "@/features/performance/components/plan/plan-lib";
import { dueIn } from "@/features/performance/components/reviews/review-parts";


describe("Performance in Arabic", () => {
  it("says where the year stands in Arabic", () => {
    const say = sayInArabic("year.NextStep");
    expect(sayInArabic("year.phase")("ResultsOut")).toBe("صدور النتائج");
    expect(say("plansNotForward", { count: 3 })).toBe("3 أشخاص لم يقدّموا خططهم");
    expect(say("nudgedToast", { count: 2 })).toBe("تم تذكير شخصين");
  });

  it("words plan checks and review due dates in Arabic", () => {
    const checks = planChecks({ objectiveCount: 0, weightTotal: 0, weightRemaining: 100, everyObjectiveHasWeight: false, openChangeRequests: 0 } as never, sayInArabic("plan.checks"));
    expect(checks[0]!.label).toBe("تحتوي الخطة على هدف واحد على الأقل");
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(dueIn(today, sayInArabic("reviews.parts"))).toBe("مستحق اليوم");
  });

  it("renders a plan badge and a shared status badge in Arabic", () => {
    renderInArabic(
      <>
        <NotStartedBadge />
        <ObjectiveStatusBadge status="OnTrack" />
      </>,
    );
    expect(screen.getByText("لم تبدأ")).toBeInTheDocument();
    expect(screen.getByText("على المسار")).toBeInTheDocument();
  });
});
