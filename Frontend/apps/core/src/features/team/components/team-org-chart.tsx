"use client";

import OrgChartWorkspace from "@/features/org-chart/components/org-chart-workspace";
import { TeamFrame } from "./team-frame";

/** The Team page's Org chart tab (D-31): the people org chart as built, opened on the manager (its default focus). */
export default function TeamOrgChart() {
  return (
    <TeamFrame tab="orgChart">
      {() => (
        <div className="mt-8 h-[clamp(520px,calc(100dvh-8rem),880px)] overflow-hidden rounded-surface bg-section">
          <OrgChartWorkspace asOf={null} replaying={false} />
        </div>
      )}
    </TeamFrame>
  );
}
