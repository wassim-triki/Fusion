import { redirect } from "next/navigation";
import { ReportsWorkspace } from "@/features/reports/reports-workspace";

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (id === "new") redirect("/reports/headcount");
  return <ReportsWorkspace key={id} reportId={id} />;
}
