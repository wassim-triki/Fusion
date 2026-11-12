import { redirect } from "next/navigation";
import { InsightsFrame } from "@/features/insights/insights-frame";
import { ReportsWorkspace } from "@/features/reports/reports-workspace";

export default async function InsightsReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id === "new") redirect("/insights/reports/headcount");
  return (
    <InsightsFrame tab="reports">
      <ReportsWorkspace key={id} reportId={id} />
    </InsightsFrame>
  );
}
