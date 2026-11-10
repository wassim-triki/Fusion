import { cn } from "@repo/ds/lib/utils";

/**
 * A tenant's initials, so a long directory can be scanned by shape before it is
 * read. Deliberately derived rather than stored: it is a reading aid, not a
 * brand, and the platform does not hold customer identity assets.
 */
export function monogramFor(name: string): string {
  const words = name
    .split(/[\s\-–—/&,.]+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);

  if (words.length === 0) {
    // A name of nothing but punctuation still needs a stable, quiet answer.
    return "—";
  }

  if (words.length === 1) {
    return words[0]!.slice(0, 2).toLocaleUpperCase();
  }

  return (words[0]![0]! + words[words.length - 1]![0]!).toLocaleUpperCase();
}

/**
 * The tint is derived from the name too, so the same tenant always reads the
 * same way down the list. Colour carries no meaning here — every state fact is
 * stated in words elsewhere in the row.
 */
const TINTS = [
  "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  "bg-violet-500/12 text-violet-700 dark:text-violet-300",
  "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  "bg-primary-tint text-foreground dark:text-primary-ink",
  "bg-rose-500/12 text-rose-700 dark:text-rose-300",
  "bg-teal-500/12 text-teal-700 dark:text-teal-300",
];

function tintFor(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index++) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return TINTS[hash % TINTS.length]!;
}

export function TenantMonogram({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <span
      // Decorative: the tenant's name sits beside it in full.
      aria-hidden="true"
      className={cn(
        "flex size-9 shrink-0 select-none items-center justify-center rounded-control text-xs font-semibold tracking-wide",
        tintFor(name),
        className
      )}
    >
      {monogramFor(name)}
    </span>
  );
}
