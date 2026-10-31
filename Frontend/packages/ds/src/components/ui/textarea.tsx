import * as React from "react"

import { cn } from "../../lib/utils"

/**
 * `voice="narrative"` is for writing people will read as prose (feedback, praise, shared notes): the editorial role,
 * the same size on every screen.
 */
function Textarea({ className, voice = "system", ...props }: React.ComponentProps<"textarea"> & { voice?: "system" | "narrative" }) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-control border border-input bg-field px-2.5 py-2 transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        voice === "narrative" ? "type-narrative max-w-none" : "text-base md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
