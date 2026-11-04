"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { FrontPagePersonDto } from "@repo/api";
import { usePhoto } from "@repo/api/query";
import {
  PersonAvatar,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@repo/ds";
import { groupPeople, type Grouping } from "../model/front-page";

export function FrontFace({
  person,
  size = "sm",
  label = false,
}: {
  person: FrontPagePersonDto;
  size?: "xs" | "sm" | "md";
  label?: boolean;
}) {
  const photo = usePhoto(person.photoUrl);
  return (
    <PersonAvatar
      name={person.name}
      photo={photo}
      size={size}
      label={label ? person.name : undefined}
    />
  );
}

/** Fixed identity marks move to their new groups, in the same face-wall grammar as the accepted drawing. */
export function PeopleView({
  people,
  by,
  date,
}: {
  people: FrontPagePersonDto[];
  by: Grouping;
  date: string;
}) {
  const t = useTranslations("overview.front");
  const locale = useLocale();
  const rtl = locale === "ar";
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(entries[0]?.contentRect.width ?? 900)
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const groups = groupPeople(people, by, date);
  const desiredColumns = by === "department" ? 3 : by === "place" ? 4 : 5;
  const columns = Math.max(
    1,
    Math.min(groups.length, width < 580 ? 1 : width < 800 ? 2 : desiredColumns)
  );
  const groupWidth = (width - (columns - 1) * 28) / columns;
  const labels: {
    key: string;
    name: string;
    count: number;
    x: number;
    y: number;
    width: number;
  }[] = [];
  const faces: { person: FrontPagePersonDto; x: number; y: number }[] = [];
  let y = 0;
  for (let row = 0; row < Math.ceil(groups.length / columns); row++) {
    let height = 0;
    let x = 0;
    const rowGroups = groups.slice(row * columns, (row + 1) * columns);
    const weights = rowGroups.map((group) =>
      Math.max(3, Math.sqrt(group.people.length))
    );
    const weight = weights.reduce((sum, value) => sum + value, 0);
    rowGroups.forEach((group, column) => {
      const currentWidth =
        by === "time"
          ? ((width - (rowGroups.length - 1) * 28) * weights[column]!) / weight
          : groupWidth;
      const facesPerRow = Math.max(1, Math.floor(currentWidth / 38));
      const name =
        by === "time"
          ? t(`tenure.${group.key as "underOne"}`)
          : (group.label ??
            t(by === "department" ? "outsideDepartments" : "unassigned"));
      labels.push({
        key: group.key,
        name,
        count: group.people.length,
        x,
        y,
        width: currentWidth,
      });
      group.people.forEach((person, index) =>
        faces.push({
          person,
          x: x + (index % facesPerRow) * 38,
          y: y + 30 + Math.floor(index / facesPerRow) * 38,
        })
      );
      height = Math.max(
        height,
        30 + Math.ceil(group.people.length / facesPerRow) * 38 + 22
      );
      x += currentWidth + 28;
    });
    y += height;
  }
  return (
    <TooltipProvider>
      <div
        ref={ref}
        className="relative min-h-64 transition-[height] duration-300"
        style={{ height: Math.max(256, y) }}
        aria-label={t("people")}
      >
        {labels.map((label) => (
          <p
            key={label.key}
            className="absolute top-0 start-0 flex max-w-full items-baseline gap-2 type-label transition-transform duration-500"
            style={{
              transform: `translate(${rtl ? -label.x : label.x}px,${label.y}px)`,
              width: label.width,
            }}
          >
            <span className="truncate">{label.name}</span>
            <span className="type-meta text-muted-foreground">
              {new Intl.NumberFormat(locale).format(label.count)}
            </span>
          </p>
        ))}
        {faces.map(({ person, x, y: top }) => (
          <div
            key={person.employeeKey}
            className="absolute top-0 start-0 transition-transform duration-500"
            style={{ transform: `translate(${rtl ? -x : x}px,${top}px)` }}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  className="block rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <FrontFace person={person} label />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>{person.name}</p>
                <p className="type-meta text-muted-foreground">
                  {[person.job, person.department ?? person.parent]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
        ))}
        {people.length === 0 ? (
          <p className="grid min-h-64 place-items-center type-body text-muted-foreground">
            {t("noPeople")}
          </p>
        ) : null}
      </div>
    </TooltipProvider>
  );
}
