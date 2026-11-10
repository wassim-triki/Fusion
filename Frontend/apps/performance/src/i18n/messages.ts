import calibration from "../../messages/en/calibration.json";
import coach from "../../messages/en/coach.json";
import common from "../../messages/en/common.json";
import conversations from "../../messages/en/conversations.json";
import cycle from "../../messages/en/cycle.json";
import cycleSetup from "../../messages/en/cycleSetup.json";
import goals from "../../messages/en/goals.json";
import objective from "../../messages/en/objective.json";
import oneOnOnes from "../../messages/en/oneOnOnes.json";
import plan from "../../messages/en/plan.json";
import progress from "../../messages/en/progress.json";
import reviews from "../../messages/en/reviews.json";
import settings from "../../messages/en/settings.json";
import team from "../../messages/en/team.json";
import year from "../../messages/en/year.json";

/** Performance's own catalogue in English, one file per namespace (`messages/<locale>/<namespace>.json`). */
export const englishMessages = { calibration, coach, common, conversations, cycle, cycleSetup, goals, objective, oneOnOnes, plan, progress, reviews, settings, team, year };

export type PerformanceMessages = typeof englishMessages;

/** Performance's own catalogue in a language, merged by the request config beside @repo/ds's and @repo/auth's. Anything but French or Arabic gets English. */
export async function loadPerformanceMessages(locale: string): Promise<PerformanceMessages> {
  if (locale !== "fr" && locale !== "ar") return englishMessages;
  const namespaces = Object.keys(englishMessages);
  const files = await Promise.all(
    namespaces.map(async (namespace) => [namespace, (await import(`../../messages/${locale}/${namespace}.json`)).default]),
  );
  return Object.fromEntries(files) as PerformanceMessages;
}
