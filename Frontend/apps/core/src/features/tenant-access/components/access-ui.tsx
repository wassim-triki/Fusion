"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Avatar,
  AvatarFallback,
  cn,
} from "@repo/ds";
import { Mail } from "lucide-react";
import type { AccessTone } from "./access-language";

/**
 * The small visual vocabulary Access is built from.
 *
 * Deliberately not badges: a page whose whole job is a list of people reads
 * better when status is a quiet mark beside a name than when every row carries a
 * filled pill competing with the name for attention. The label is always present,
 * so the colour is reinforcement rather than the message.
 */

// Tones resolve to the design system's semantic state colors, so a status dot
// here is the same green/amber a badge or a chart uses elsewhere — one state
// language, not a per-screen palette.
const DOT_TONE: Record<AccessTone, string> = {
  neutral: "bg-muted-foreground",
  positive: "bg-success",
  caution: "bg-warning",
  muted: "bg-muted-foreground/40",
};

const TEXT_TONE: Record<AccessTone, string> = {
  neutral: "text-foreground",
  positive: "text-foreground",
  caution: "text-foreground",
  muted: "text-muted-foreground",
};

export function StatusMark({
  tone,
  children,
  className,
}: {
  tone: AccessTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("type-label inline-flex items-center gap-2", TEXT_TONE[tone], className)}>
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", DOT_TONE[tone])} />
      {children}
    </span>
  );
}

export function initialsOf(name?: string): string {
  return (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Identity mark. A person gets their initials on the design system's avatar; an
 * invitation gets a dashed envelope, because an invited address is not yet a
 * person in this tenant and should not be dressed as one.
 */
export function IdentityMark({
  name,
  invitation,
  size = "default",
}: {
  name?: string;
  invitation?: boolean;
  size?: "default" | "lg";
}) {
  if (invitation) {
    return (
      <span
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full border border-dashed text-muted-foreground",
          size === "lg" ? "size-10" : "size-9"
        )}
      >
        <Mail className="size-4" />
      </span>
    );
  }

  return (
    <Avatar size={size} className={size === "lg" ? "size-10" : "size-9"}>
      <AvatarFallback hue={name} className="type-label bg-muted text-muted-foreground">
        {initialsOf(name) || "—"}
      </AvatarFallback>
    </Avatar>
  );
}

/** Names the person a confirmation is about, so the decision is never abstract. */
export function SubjectCard({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-control border px-3 py-2.5">
      <IdentityMark name={title} />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** The consequence of this decision only — never the whole rule set. */
  consequence: string;
  subject?: { title: string; subtitle: string };
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  problem?: string | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}

export function ConfirmDialog({
  open,
  title,
  consequence,
  subject,
  confirmLabel,
  destructive = false,
  busy = false,
  problem = null,
  onConfirm,
  onOpenChange,
}: ConfirmDialogProps) {
  const t = useTranslations("admins");
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {/* Width is left to the design system: its own data-size rule outranks a
          local max-width, so setting one here only overflows the content. */}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{consequence}</AlertDialogDescription>
        </AlertDialogHeader>

        {subject ? <SubjectCard title={subject.title} subtitle={subject.subtitle} /> : null}

        {problem ? (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t("confirm.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            variant={destructive ? "destructive" : "default"}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
