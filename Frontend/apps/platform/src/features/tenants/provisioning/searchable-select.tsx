"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "@repo/ds/icons";
import { Button } from "@repo/ds/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@repo/ds/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@repo/ds/components/ui/popover";
import { cn } from "@repo/ds/lib/utils";

/**
 * A bounded choice that is searched rather than scrolled.
 *
 * The time-zone list runs to several hundred entries, which a plain select asks
 * the operator to hunt through by eye. Typing what they already know — a city,
 * a country, an offset, a locale code — is how the value is actually recalled.
 *
 * Keyboard behaviour is the ordinary combobox contract and nothing more: arrows
 * move, Enter commits, Escape closes. No invented shortcuts.
 */

/**
 * Plain substring matching, replacing the default fuzzy score.
 *
 * Fuzzy ranking treats a search as a scattered sequence of letters, so "tunis"
 * scored `Africa/Kinshasa` — the letters appear in order — above nothing at all.
 * For a list of place names and offsets that is worse than useless: the operator
 * types what they know and has to check whether the answer is really there.
 * Every term must appear, so "europe par" finds Europe/Paris and nothing else.
 */
function matches(value: string, search: string): number {
  const haystack = value.toLowerCase();
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);

  return terms.every((term) => haystack.includes(term)) ? 1 : 0;
}

export interface SearchableOption {
  value: string;
  label: string;
  /** Text the search matches in addition to the label. */
  keywords: string;
  /** Optional trailing detail, such as a zone's current offset. */
  detail?: string;
  /** Optional heading this option is listed under. */
  group?: string;
}

export function SearchableSelect({
  id,
  options,
  value,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  invalid,
  describedBy,
  onChange,
  onBlur,
}: {
  id: string;
  options: SearchableOption[];
  value: string;
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage: string;
  invalid?: boolean;
  describedBy?: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  // Several hundred time zones, regrouped on every render — including every
  // open/close — until this was keyed on the list itself.
  const groups = useMemo(() => {
    const byGroup = new Map<string, SearchableOption[]>();
    for (const option of options) {
      const key = option.group ?? "";
      const existing = byGroup.get(key);
      if (existing) existing.push(option);
      else byGroup.set(key, [option]);
    }
    return byGroup;
  }, [options]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          onBlur={onBlur}
          className={cn(
            "w-full justify-between font-normal",
            !selected && "text-muted-foreground",
            invalid && "border-destructive"
          )}
        >
          <span className="truncate">
            {selected ? (
              <>
                {selected.label}
                {selected.detail ? (
                  <span className="ms-2 text-muted-foreground">
                    {selected.detail}
                  </span>
                ) : null}
              </>
            ) : (
              placeholder
            )}
          </span>
          <ChevronsUpDown
            aria-hidden="true"
            className="ms-2 size-4 shrink-0 text-muted-foreground"
          />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) p-0"
      >
        <Command filter={matches}>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            {[...groups.entries()].map(([group, entries]) => (
              <CommandGroup key={group} heading={group || undefined}>
                {entries.map((option) => (
                  <CommandItem
                    key={option.value || "__default__"}
                    // cmdk searches this string, so it carries the label plus
                    // every other way the option might be recalled.
                    value={`${option.label} ${option.keywords}`}
                    onSelect={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <Check
                      aria-hidden="true"
                      className={cn(
                        "me-2 size-4 shrink-0",
                        option.value === value ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {option.detail ? (
                      <span className="ms-2 shrink-0 text-xs text-muted-foreground">
                        {option.detail}
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
