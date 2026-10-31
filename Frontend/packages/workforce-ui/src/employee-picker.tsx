"use client";

import { useEffect, useMemo, useState } from "react";
import { UserRound } from "lucide-react";
import { Avatar, AvatarFallback } from "@repo/ds/components/ui/avatar";
import { EntityPicker, type EntityOption } from "@repo/ds/components/ui/entity-picker";
import { useEmployeePicker } from "./hooks";

export interface PickedEmployee {
  id: string;
  name: string;
  /** Role / org context, shown under the name once a person is chosen. */
  subtitle?: string;
}

/** Two-letter monogram for the avatar fallback. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

function PersonAvatar({
  name,
  className,
  accent = false,
}: {
  name: string;
  className?: string;
  /** Tint the fallback with the brand color — used for the chosen person in the trigger. */
  accent?: boolean;
}) {
  return (
    <Avatar className={className}>
      <AvatarFallback
        hue={accent ? null : name}
        className={
          accent
            ? "bg-primary text-[0.65rem] font-medium text-primary-foreground"
            : "text-[0.65rem] font-medium"
        }
      >
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

/** The role · org-unit line beneath a person's name. */
function subtitleFor(employee: {
  jobTitle: string | null;
  employmentStatus: string;
  orgUnit: { name: string } | null;
}): string {
  const parts = [employee.jobTitle, employee.orgUnit?.name].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : employee.employmentStatus;
}

/** Debounces the search term so a burst of keystrokes issues one request. */
function useDebounced(value: string, delay = 200): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * Search-and-choose-one person, over the tenant workforce. Shows a prefetched batch on
 * open, searches the server as you type, and reads the selection back with a brand-tinted
 * avatar. Built on the shared DS `EntityPicker`; usable from any workforce-facing surface.
 */
export function EmployeePicker({
  value,
  onChange,
  placeholder = "Search people…",
}: {
  value: PickedEmployee | null;
  onChange: (employee: PickedEmployee) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const debounced = useDebounced(term);
  const { data, isFetching, error, refetch } = useEmployeePicker(debounced, open);
  const items = useMemo(() => data?.items ?? [], [data]);

  const options: EntityOption[] = useMemo(
    () =>
      items.map((employee) => ({
        id: employee.employeeId,
        title: employee.displayName,
        description: subtitleFor(employee),
        media: <PersonAvatar name={employee.displayName} className="size-6" />,
      })),
    [items]
  );

  const selection = value
    ? {
        title: value.name,
        media: <PersonAvatar name={value.name} className="size-6" accent />,
      }
    : null;

  return (
    <EntityPicker
      selection={selection}
      selectedId={value?.id ?? null}
      options={options}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Re-fetch on open so a transient failure of the initial (empty-term) batch
        // self-heals on the next click rather than sticking until reload.
        if (next) {
          if (error) void refetch();
        } else {
          setTerm("");
        }
      }}
      search={term}
      onSearchChange={setTerm}
      onSelect={(id) => {
        const employee = items.find((candidate) => candidate.employeeId === id);
        if (!employee) return;
        onChange({
          id: employee.employeeId,
          name: employee.displayName,
          subtitle: subtitleFor(employee),
        });
        setOpen(false);
        setTerm("");
      }}
      loading={isFetching && options.length === 0}
      placeholder={placeholder}
      placeholderIcon={<UserRound className="size-3.5" aria-hidden />}
      searchPlaceholder="Type a name…"
      emptyLabel={`No people match “${term.trim()}”.`}
      hint="No people found."
    />
  );
}
