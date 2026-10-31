import type { ReactNode } from "react";
import { cn } from "../lib/utils";

export interface SaidProps {
  children: ReactNode;
  /** A block of its own (a paragraph) or inline in a line of text. */
  as?: "p" | "span" | "blockquote";
  className?: string;
}

/**
 * Someone's own words (a bio, praise, feedback, a note, a comment, an answer): always in Fusion's editorial serif and in
 * quotes, so what a person wrote never reads like the product talking. The quotes follow the page's language (« » in
 * French), and the text takes its direction from itself, since people write in whatever language they use.
 */
export function Said({ children, as: Tag = "p", className }: SaidProps) {
  return (
    <Tag dir="auto" data-slot="said" className={cn("type-narrative whitespace-pre-line text-foreground", className)}>
      <q className="[quotes:auto]">{children}</q>
    </Tag>
  );
}
