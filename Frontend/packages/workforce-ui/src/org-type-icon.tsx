import { Box, Briefcase, Building, Building2, Network, Shapes, Users, type IconComponent } from "@repo/ds/icons";
import { cn } from "@repo/ds/lib/utils";

const ICONS: Record<string, IconComponent> = {
  organization: Building2,
  businessunit: Briefcase,
  division: Network,
  department: Building,
  team: Users,
  unit: Box,
};

/** One fixed icon per organization type, so the icon itself says what kind of unit a row is. */
function orgTypeIcon(typeName: string | null | undefined): IconComponent {
  return ICONS[(typeName ?? "").toLowerCase().replace(/[^a-z]/g, "")] ?? Shapes;
}

export function OrgTypeIcon({ typeName, className }: { typeName: string | null | undefined; className?: string }) {
  const Icon = orgTypeIcon(typeName);
  return <Icon aria-hidden className={cn("size-4 shrink-0", className)} strokeWidth={1.75} />;
}
