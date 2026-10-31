import type { CSSProperties } from "react"

import { cn } from "../../lib/utils"

export type PersonAvatarSize = "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "profile"

const SIZE: Record<PersonAvatarSize, string> = {
  xs: "size-6 text-[0.5625rem]",
  sm: "size-8 text-[0.6875rem]",
  md: "size-9 text-xs",
  lg: "size-11 text-sm",
  xl: "size-16 text-xl",
  "2xl": "size-[5.5rem] text-[1.75rem]",
  profile: "size-[9.5rem] text-[2.75rem] font-medium",
}

/** Two letters from the display name, deterministic: first and last word. */
export function personInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "—"
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts.at(-1)![0]!).toUpperCase()
}

/** One of the five identity hues, picked from a stable key (the person's name unless a page has a better one). */
export function personHue(seed: string): 1 | 2 | 3 | 4 | 5 {
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return ((h % 5) + 1) as 1 | 2 | 3 | 4 | 5
}

/** Initials in the person's hue: hue text on a 16% fill, inside a 60% ring. Spread `style` and `className` on the circle. */
export function personHueProps(seed: string): { style: CSSProperties; className: string } {
  return {
    style: { "--hue": `var(--identity-${personHue(seed)})` } as CSSProperties,
    className:
      "border-[1.5px] border-[color:color-mix(in_oklab,var(--hue)_60%,transparent)] bg-[color:color-mix(in_oklab,var(--hue)_16%,var(--card))] text-[color:var(--hue)]",
  }
}

/**
 * A person's mark: their photo when one is loaded, their initials otherwise. Decorative by default, since the
 * name always sits beside it; pass `label` where the avatar stands alone.
 * `photo` is a displayable address (an object URL for photos that load through the API client). Initials take an
 * identity hue from the name, so the same person carries the same colour on every screen and in every module.
 */
function PersonAvatar({
  name,
  photo,
  size = "md",
  label,
  className,
}: {
  name: string
  photo?: string | null
  size?: PersonAvatarSize
  label?: string
  className?: string
}) {
  const hue = photo ? null : personHueProps(name)
  return (
    <span
      data-slot="person-avatar"
      style={hue?.style}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-muted font-semibold tracking-tight text-muted-foreground tabular-nums select-none",
        hue?.className,
        SIZE[size],
        className
      )}
    >
      {photo ? (
        <img src={photo} alt="" draggable={false} className="size-full object-cover" />
      ) : (
        personInitials(name)
      )}
    </span>
  )
}

export { PersonAvatar }
