import { Avatar, AvatarFallback } from "@repo/ds/components/ui/avatar";
import { cn } from "@repo/ds";

export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0]!.toUpperCase()).join("") || "?";
}

export type PersonInitialsSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE: Record<PersonInitialsSize, { box: string; text: string }> = {
  xs: { box: "size-6", text: "text-[0.6rem]" },
  sm: { box: "size-7", text: "text-[0.65rem]" },
  md: { box: "size-8", text: "text-[0.7rem]" },
  lg: { box: "size-10", text: "text-xs" },
  xl: { box: "size-14", text: "text-base" },
};

/** A person as restrained initials: the identity grammar for people without photos. */
export function PersonInitials({ name, size = "md", className }: { name: string | null | undefined; size?: PersonInitialsSize; className?: string }) {
  return (
    <Avatar className={cn(SIZE[size].box, className)}>
      <AvatarFallback hue={name} className={cn("font-semibold", SIZE[size].text)}>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

/** Several people at once, overlapping; past `max` the rest fold into a count. */
export function AvatarStack({
  names,
  size = "sm",
  max = 4,
  className,
}: {
  names: readonly (string | null)[];
  size?: PersonInitialsSize;
  max?: number;
  className?: string;
}) {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return (
    <span className={cn("flex items-center", className)}>
      {shown.map((name, index) => (
        <PersonInitials
          key={`${name}-${index}`}
          name={name}
          size={size}
          className={cn("ring-2 ring-background", index > 0 && (size === "xl" ? "-ms-4" : size === "lg" ? "-ms-2.5" : "-ms-1.5"))}
        />
      ))}
      {rest > 0 ? <span className="ms-1.5 type-meta tabular-nums text-muted-foreground">+{rest}</span> : null}
    </span>
  );
}

