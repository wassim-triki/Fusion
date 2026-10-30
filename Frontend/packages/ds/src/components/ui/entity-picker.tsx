"use client"

import * as React from "react"

import { cn } from "../../lib/utils"
import { Button } from "./button"
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "./combobox"
import { Item, ItemContent, ItemDescription, ItemTitle } from "./item"
import { Spinner } from "./spinner"

/**
 * One result: a media slot (avatar, icon, …) beside a two-line label. Generic over
 * the entity kind — people, org units, or anything else you search and pick one of.
 */
export interface EntityOption {
  id: string
  title: string
  description?: string
  media?: React.ReactNode
}

/**
 * The chosen entity as it reads back in the closed trigger. Deliberately just the
 * primary label + media: the trigger stays a single, fixed-height line regardless of
 * how the selection was made, while the richer secondary line lives in the list rows.
 */
export interface EntitySelection {
  title: string
  media?: React.ReactNode
}

/**
 * A reusable "search-and-choose-one" control, composed from the DS Combobox +
 * Item primitives (the same shape as the shadcn/reui combobox-16 pattern: a Button
 * trigger that reads back the selection, a search input in the popup, and two-line
 * media rows). Generalized past that static demo in the ways real data needs:
 *
 * - **Externally filtered.** `filter={null}` and a controlled input, so the caller
 *   owns the query — a live server search or a local list, same shell. The results
 *   the caller hands in appear the moment the popup opens (prefetch a first batch).
 * - **Kind-agnostic.** `media` is a slot, so avatars (people) and icons (org units)
 *   use one component; `title` + `description` carry the two lines.
 * - **Stateful.** Loading, empty-after-search, and pre-search hint are first-class,
 *   and selection is a string id mapped back by the caller (so an id chosen in a
 *   prior session still reads back even when it isn't in the current result page).
 */
export function EntityPicker({
  selection,
  selectedId,
  options,
  open,
  onOpenChange,
  search,
  onSearchChange,
  onSelect,
  loading = false,
  disabled = false,
  placeholder,
  placeholderIcon,
  searchPlaceholder,
  emptyLabel,
  hint,
  triggerClassName,
  contentClassName,
}: {
  selection: EntitySelection | null
  selectedId: string | null
  options: EntityOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
  search: string
  onSearchChange: (value: string) => void
  onSelect: (id: string) => void
  loading?: boolean
  disabled?: boolean
  placeholder: string
  placeholderIcon?: React.ReactNode
  searchPlaceholder: string
  /** Shown when the search returned nothing. */
  emptyLabel: string
  /** Shown instead of the empty label before the user has typed (e.g. "Start typing to search"). */
  hint?: string
  triggerClassName?: string
  contentClassName?: string
}) {
  const ids = React.useMemo(() => options.map((option) => option.id), [options])

  // Radix modal dialogs trap focus: a popup portaled to <body> loses focus the instant its search
  // input is clicked, closing it. Portal the popup into the enclosing dialog (when there is one) so
  // the input stays inside the focus scope; outside a dialog it goes to <body>. Resolved on open, once the trigger is mounted.
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const [container, setContainer] = React.useState<HTMLElement | null>(null)
  React.useEffect(() => {
    if (open)
      setContainer(
        triggerRef.current?.closest<HTMLElement>("[data-slot='dialog-content']") ?? null
      )
  }, [open])

  return (
    <Combobox
      items={ids}
      value={selectedId}
      onValueChange={(value) => {
        if (typeof value === "string") onSelect(value)
      }}
      filter={null}
      open={open}
      onOpenChange={onOpenChange}
      inputValue={search}
      onInputValueChange={onSearchChange}
    >
      <ComboboxTrigger
        disabled={disabled}
        render={
          <Button
            ref={triggerRef}
            variant="outline"
            className={cn(
              "h-auto min-h-8 w-full justify-between gap-2 py-1 font-normal",
              triggerClassName
            )}
          />
        }
      >
        {selection ? (
          <span className="flex min-w-0 items-center gap-2.5 text-start">
            {selection.media}
            <span className="min-w-0 truncate text-sm font-medium text-foreground">
              {selection.title}
            </span>
          </span>
        ) : (
          <span className="flex items-center gap-2 truncate text-muted-foreground">
            {placeholderIcon}
            {placeholder}
          </span>
        )}
      </ComboboxTrigger>

      <ComboboxContent
        container={container ?? undefined}
        className={cn(
          "max-w-(--anchor-width) min-w-(--anchor-width)",
          contentClassName
        )}
      >
        <ComboboxInput showTrigger={false} placeholder={searchPlaceholder} />
        <ComboboxList>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Spinner className="size-3.5" /> Loading…
            </div>
          ) : options.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {search.trim() === "" ? (hint ?? emptyLabel) : emptyLabel}
            </p>
          ) : (
            options.map((option) => (
              <ComboboxItem key={option.id} value={option.id} className="py-1.5">
                <Item size="xs" className="min-w-0 border-0 p-0">
                  {option.media}
                  <ItemContent className="min-w-0">
                    <ItemTitle className="truncate">{option.title}</ItemTitle>
                    {option.description ? (
                      <ItemDescription className="truncate">
                        {option.description}
                      </ItemDescription>
                    ) : null}
                  </ItemContent>
                </Item>
              </ComboboxItem>
            ))
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
