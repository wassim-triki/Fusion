import { ReportsWorkspace } from "@/features/reports/reports-workspace";

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ReportsWorkspace key={id} reportId={id} />;
}
