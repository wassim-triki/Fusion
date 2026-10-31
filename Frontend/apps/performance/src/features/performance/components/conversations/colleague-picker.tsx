"use client";

import { useEffect, useMemo, useState } from "react";
import type { DirectoryPersonDto } from "@repo/api";
import { Avatar, AvatarFallback } from "@repo/ds/components/ui/avatar";
import { Button } from "@repo/ds/components/ui/button";
import { EntityPicker, type EntityOption } from "@repo/ds/components/ui/entity-picker";
import { User, X } from "@/lib/icons";
import { useDirectory } from "../../api/use-conversations";
import { initials } from "../plan/plan-lib";
import { useTranslations } from "next-intl";

export interface PickedColleague {
  employeeId: string;
  displayName: string;
  subtitle: string | null;
}

function useDebounced(value: string, delay = 200): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function subtitle(person: DirectoryPersonDto): string | null {
  return [person.jobTitle, person.orgUnitName].filter(Boolean).join(" · ") || null;
}

function PersonMark({ name }: { name: string }) {
  return (
    <Avatar className="size-6">
      <AvatarFallback hue={name} className="type-mark">{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

/**
 * Search the company's active colleagues by name and choose one. It reads Performance's colleague directory, which
 * every employee can search, unlike Core HR's own people search. `exclude` keeps out people already chosen and the
 * caller.
 */
export function ColleaguePicker({
  value,
  onChange,
  exclude = [],
  placeholder = "Search colleagues",
  id,
}: {
  value: PickedColleague | null;
  onChange: (person: PickedColleague) => void;
  exclude?: readonly string[];
  placeholder?: string;
  id?: string;
}) {
  const t = useTranslations("conversations.ColleaguePicker");
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const debounced = useDebounced(term);
  const directory = useDirectory(debounced, open);
  const people = useMemo(() => (directory.data ?? []).filter((p) => !exclude.includes(p.employeeId)), [directory.data, exclude]);
  const options: EntityOption[] = people.map((person) => ({
    id: person.employeeId,
    title: person.displayName,
    description: subtitle(person) ?? undefined,
    media: <PersonMark name={person.displayName} />,
  }));
  const typed = term.trim();

  return (
    <div id={id}>
      <EntityPicker
        selection={value ? { title: value.displayName, media: <PersonMark name={value.displayName} /> } : null}
        selectedId={value?.employeeId ?? null}
        options={options}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setTerm("");
        }}
        search={term}
        onSearchChange={setTerm}
        onSelect={(employeeId) => {
          const person = people.find((p) => p.employeeId === employeeId);
          if (!person) return;
          onChange({ employeeId: person.employeeId, displayName: person.displayName, subtitle: subtitle(person) });
          setOpen(false);
          setTerm("");
        }}
        loading={directory.isLoading && typed.length >= 2}
        placeholder={placeholder}
        placeholderIcon={<User className="size-3.5" aria-hidden />}
        searchPlaceholder={t("typeAtLeastTwoLetters")}
        emptyLabel={directory.error ? t("colleaguesCouldntBeLoadedTry") : typed.length < 2 ? t("typeANameToSearch") : t("noColleaguesMatch", { typed })}
        hint={t("typeANameToSearch")}
      />
    </div>
  );
}

/** Several colleagues, up to a limit: the chosen ones as removable rows, then a picker for the next. */
export function ColleaguesPicker({
  value,
  onChange,
  max,
  exclude = [],
  id,
}: {
  value: readonly PickedColleague[];
  onChange: (people: PickedColleague[]) => void;
  max: number;
  exclude?: readonly string[];
  id?: string;
}) {
  const t = useTranslations("conversations.ColleaguesPicker");
  const chosen = value.map((p) => p.employeeId);
  return (
    <div className="space-y-2">
      {value.length > 0 ? (
        <ul className="space-y-1.5">
          {value.map((person) => (
            <li key={person.employeeId} className="flex items-center gap-2.5 rounded-control bg-inlay px-3 py-2">
              <PersonMark name={person.displayName} />
              <span className="min-w-0 flex-1">
                <span className="block truncate type-label text-foreground">{person.displayName}</span>
                {person.subtitle ? <span className="block truncate type-meta text-muted-foreground">{person.subtitle}</span> : null}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("remove", { displayName: person.displayName })}
                onClick={() => onChange(value.filter((p) => p.employeeId !== person.employeeId))}
              >
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {value.length < max ? (
        <ColleaguePicker
          id={id}
          value={null}
          exclude={[...exclude, ...chosen]}
          placeholder={value.length === 0 ? t("searchColleagues") : t("addAnother")}
          onChange={(person) => onChange([...value, person])}
        />
      ) : null}
    </div>
  );
}
