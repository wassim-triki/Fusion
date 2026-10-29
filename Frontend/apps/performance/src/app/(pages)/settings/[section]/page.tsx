"use client";

import { use } from "react";
import { PerformanceSettingsSectionHost } from "@/features/settings/section-host";
import { NotificationsSettings } from "@/features/settings/sections/notifications";
import { CompetenciesSettings } from "@/features/settings/sections/competencies";
import {
  AiAndDataSettings,
  ConversationsSettings,
  PlanningSettings,
  ReviewsSettings,
} from "@/features/settings/sections/cycle-sections";
import { RatingScaleSettings } from "@/features/settings/sections/rating-scale";
import { ReviewQuestionsSettings } from "@/features/settings/sections/review-questions";

/** One Performance settings section, shown once the server says the person may see it. */
export default function SettingsSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section: id } = use(params);
  return (
    <PerformanceSettingsSectionHost
      id={id}
      render={(section) => {
        switch (section.id) {
          case "rating-scale":
            return <RatingScaleSettings section={section} />;
          case "competencies":
            return <CompetenciesSettings section={section} />;
          case "review-questions":
            return <ReviewQuestionsSettings section={section} />;
          case "reviews":
            return <ReviewsSettings section={section} />;
          case "planning":
            return <PlanningSettings section={section} />;
          case "conversations":
            return <ConversationsSettings section={section} />;
          case "notifications":
            return <NotificationsSettings section={section} />;
          default:
            return <AiAndDataSettings section={section} />;
        }
      }}
    />
  );
}
