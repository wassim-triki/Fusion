import admins from "../../messages/en/admins.json";
import catalog from "../../messages/en/catalog.json";
import changes from "../../messages/en/changes.json";
import checklists from "../../messages/en/checklists.json";
import common from "../../messages/en/common.json";
import companyImport from "../../messages/en/companyImport.json";
import frame from "../../messages/en/frame.json";
import invite from "../../messages/en/invite.json";
import orgChart from "../../messages/en/orgChart.json";
import organization from "../../messages/en/organization.json";
import overview from "../../messages/en/overview.json";
import people from "../../messages/en/people.json";
import profile from "../../messages/en/profile.json";
import settings from "../../messages/en/settings.json";
import team from "../../messages/en/team.json";
import wfAccess from "../../messages/en/wfAccess.json";

/** Core HR's own catalogue in English, one file per namespace (`messages/<locale>/<namespace>.json`). */
export const englishMessages = { admins, catalog, changes, checklists, common, companyImport, frame, invite, orgChart, organization, overview, people, profile, settings, team, wfAccess };

export type CoreMessages = typeof englishMessages;

/** Core HR's own catalogue in a language, merged by the request config beside @repo/ds's and @repo/auth's. Anything but French or Arabic gets English. */
export async function loadCoreMessages(locale: string): Promise<CoreMessages> {
  if (locale !== "fr" && locale !== "ar") return englishMessages;
  const namespaces = Object.keys(englishMessages);
  const files = await Promise.all(
    namespaces.map(async (namespace) => [namespace, (await import(`../../messages/${locale}/${namespace}.json`)).default]),
  );
  return Object.fromEntries(files) as CoreMessages;
}
