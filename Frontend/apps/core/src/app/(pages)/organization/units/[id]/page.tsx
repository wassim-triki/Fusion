import OrganizationUnitPage from "@/features/organization/components/unit-page";

export const dynamic = "force-dynamic";

export default async function UnitPage({ params }: { params: Promise<{ id: string }> }) {
  return <OrganizationUnitPage id={(await params).id} />;
}
