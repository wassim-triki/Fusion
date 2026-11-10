import { BarChart3, BookOpen, BrainCircuit, Briefcase, UsersRound, Video, type IconComponent } from "../icons";
import type { ShellModule } from "./types";

/**
 * The Fusion modules as the Platform console's provisioning catalogue lists them. Tenant navigation reads
 * the shared registry in `@repo/api` (`FUSION_MODULE_REGISTRY`) and draws it with {@link FUSION_MODULE_ICONS}.
 */
export const FUSION_MODULES: ShellModule[] = [
  { key: "core", label: "Core HR", description: "Workforce & organization", icon: BrainCircuit, href: "/core" },
  { key: "learning", label: "Learning", description: "Training & onboarding", icon: BookOpen, href: "/learning" },
  { key: "performance", label: "Performance", description: "Workspace", icon: BarChart3, href: "/performance" },
  { key: "recruitment", label: "Recruitment", description: "Hiring pipeline", icon: UsersRound, href: "/recruitment" },
  { key: "interview", label: "Interview", description: "Candidate assessments", icon: Video, href: "/interview" },
];

/** The Fusion sidebar's icon for each module of the shared registry, by module key. */
export const FUSION_MODULE_ICONS: Record<string, IconComponent> = {
  core: BrainCircuit,
  performance: BarChart3,
  learning: BookOpen,
  recruitment: Briefcase,
  interview: Video,
};
