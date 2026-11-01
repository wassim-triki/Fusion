import ImportSession from "@/features/company-import/components/import-session";

export const dynamic = "force-dynamic";

export default async function ImportSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <ImportSession id={sessionId} />;
}
