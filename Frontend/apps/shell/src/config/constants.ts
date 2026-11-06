import { type Microfrontend } from "@/types";

export const APP_NAME = "Frontend Platform";
export const APP_DESCRIPTION =
  "A production-ready microfrontend architecture built with Turborepo, Next.js, and shared UI components.";

export const MICROFRONTENDS: Microfrontend[] = [
  {
    title: "Interview",
    description: "Manage interview workflows, scheduling, and candidate assessments.",
    href: "/interview",
    badge: "Microfrontend",
  },
  {
    title: "Core",
    description: "Core HR workforce and organization management.",
    href: "/core",
    badge: "Microfrontend",
  },
  {
    title: "Learning",
    description: "Learning management, courses, and knowledge base resources.",
    href: "/learning",
    badge: "Microfrontend",
  },
  {
    title: "Performance",
    description: "Performance workspace",
    href: "/performance",
    badge: "Microfrontend",
  },
  {
    title: "Recruitment",
    description: "Manage job openings, track applicant pipelines, and streamline hiring.",
    href: "/recruitment",
    badge: "Microfrontend",
  },
];
