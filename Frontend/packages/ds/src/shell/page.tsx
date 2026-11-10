import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "../icons";
import { cn } from "../lib/utils";

export interface PageContainerProps {
  children: ReactNode;
  className?: string;
  /** Wider container for dense tables/workbenches. */
  width?: "default" | "wide" | "narrow";
}

const WIDTHS: Record<NonNullable<PageContainerProps["width"]>, string> = {
  narrow: "max-w-3xl",
  default: "max-w-6xl",
  wide: "max-w-[1400px]",
};

/** Consistent page padding + max-width so every Core/Perf page shares one rhythm. */
export function PageContainer({ children, className, width = "default" }: PageContainerProps) {
  return (
    <div className={cn("mx-auto w-full px-6 py-6", WIDTHS[width], className)}>{children}</div>
  );
}

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Primary + secondary actions, right-aligned. */
  actions?: ReactNode;
  /** A short context line above the title. */
  eyebrow?: ReactNode;
  /** A way back for nested or focused pages, above the title. */
  back?: { href: string; label: string };
  /** What the page is about, set before the title (a record's people). */
  leading?: ReactNode;
  /** A state badge beside the title, outside the heading so it keeps its own type and the title its accessible name. */
  status?: ReactNode;
  /** `display` for a module's home pages; `default` everywhere else. */
  size?: "default" | "display";
  className?: string;
}

/**
 * The one page heading for Core and Performance: back link, eyebrow, the single `h1`, description and
 * right-aligned actions, with an optional leading object and status badge.
 */
export function PageHeader({ title, description, actions, eyebrow, back, leading, status, size = "default", className }: PageHeaderProps) {
  const heading = <h1 className={cn(size === "display" ? "type-display" : "type-page-title", "text-foreground")}>{title}</h1>;
  return (
    <div className={cn("mb-6", className)}>
      {back ? (
        <Link
          href={back.href}
          className="mb-3 inline-flex items-center gap-1.5 rounded-detail text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          {leading ? <div className="shrink-0">{leading}</div> : null}
          <div className="min-w-0">
            {eyebrow ? <div className="mb-1">{eyebrow}</div> : null}
            {status ? <div className="flex flex-wrap items-center gap-2.5">{heading}{status}</div> : heading}
            {description ? (
              typeof description === "string" ? (
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
              ) : (
                // Element descriptions (e.g. skeleton placeholders) may contain
                // block content, which is invalid inside <p>.
                <div className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</div>
              )
            ) : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export interface PageToolbarProps {
  children: ReactNode;
  className?: string;
}

/** Filter / scope control strip that sits between the header and the main content. */
export function PageToolbar({ children, className }: PageToolbarProps) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-center gap-3", className)}>{children}</div>
  );
}
