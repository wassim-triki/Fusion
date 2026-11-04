"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { FrontPageDto } from "@repo/api";
import { useFormat } from "@repo/ds/lib/use-format";
import {
  dayNumber,
  departmentColor,
  departmentKey,
  frontEvents,
  growthMonths,
} from "../model/front-page";

const W = 1028,
  H = 250,
  X0 = 30,
  X1 = 1024,
  Y0 = 10,
  Y1 = 214;

export function GrowthView({
  data,
  date,
  replaying,
  highlighted,
  groups,
  onDate,
}: {
  data: FrontPageDto;
  date: string;
  replaying: boolean;
  highlighted: string | null;
  groups: { key: string; label: string | null }[];
  onDate: (date: string) => void;
}) {
  const t = useTranslations("overview.front");
  const format = useFormat();
  const locale = useLocale();
  const [hover, setHover] = useState<string | null>(null);
  const months = useMemo(() => growthMonths(data), [data]);
  const events = useMemo(() => frontEvents(data.people), [data.people]);
  const range = Math.max(
    1,
    dayNumber(data.lastDate) - dayNumber(data.firstDate)
  );
  const x = (day: string) =>
    X0 + ((dayNumber(day) - dayNumber(data.firstDate)) / range) * (X1 - X0);
  const max = Math.max(4, ...months.map((m) => m.people.length));
  const step = max <= 4 ? 1 : max <= 20 ? 5 : Math.ceil(max / 20) * 5;
  const ceiling = step * 4;
  const y = (value: number) => Y1 - (value / ceiling) * (Y1 - Y0);
  const cumulative = useMemo(
    () =>
      months.map((month) => {
        let count = 0;
        return groups.map(
          (group) =>
            (count += month.people.filter(
              (p) => departmentKey(p) === group.key
            ).length)
        );
      }),
    [months, groups]
  );
  const polygon = (group: number) =>
    [
      ...months.map(
        (month, i) => `${x(month.date)},${y(cumulative[i]![group]!)}`
      ),
      ...months
        .map(
          (month, i) =>
            `${x(month.date)},${y(group ? cumulative[i]![group - 1]! : 0)}`
        )
        .reverse(),
    ].join(" ");
  const years = [...new Set(months.map((m) => Number(m.date.slice(0, 4))))];
  const tickYears = years.filter(
    (_, i) => i % Math.max(1, Math.ceil(years.length / 10)) === 0
  );
  const shown = months.find((m) => m.date === hover);
  const joined = shown
    ? events.filter(
        (event) =>
          event.kind === "joins" &&
          event.date.slice(0, 7) === shown.date.slice(0, 7)
      )
    : [];
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const readoutPosition = shown
    ? Math.max(2, Math.min(74, (x(shown.date) / W) * 100 - 12))
    : 2;
  const selectMonth = (clientX: number, element: HTMLElement) => {
    const bounds = element.getBoundingClientRect();
    const point = ((clientX - bounds.left) / bounds.width) * W;
    const closest = months.reduce(
      (best, month) =>
        Math.abs(x(month.date) - point) < Math.abs(x(best.date) - point)
          ? month
          : best,
      months[0]!
    );
    setHover(closest.date);
    onDate(closest.date);
  };

  return (
    <div className="relative" onPointerLeave={() => setHover(null)}>
      <div
        tabIndex={0}
        role="group"
        aria-label={t("chartLabel")}
        className="outline-none focus-visible:rounded-control focus-visible:ring-2 focus-visible:ring-ring"
        onPointerMove={(event) => {
          if (!replaying) selectMonth(event.clientX, event.currentTarget);
        }}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          const index = months.findIndex((m) => m.date >= date);
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? months.length - 1
                : Math.max(
                    0,
                    Math.min(
                      months.length - 1,
                      index + (event.key === "ArrowRight" ? 1 : -1)
                    )
                  );
          setHover(months[next]!.date);
          onDate(months[next]!.date);
        }}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block w-full cursor-crosshair"
          role="img"
          aria-label={t("chartLabel")}
        >
          <defs>
            <clipPath id="growth-past">
              <rect
                x={X0}
                y={0}
                width={Math.max(0, x(data.today) - X0)}
                height={H}
              />
            </clipPath>
            <clipPath id="growth-future">
              <rect
                x={x(data.today)}
                y={0}
                width={X1 - x(data.today)}
                height={H}
              />
            </clipPath>
            <clipPath id="growth-replay">
              <rect x={0} y={0} width={replaying ? x(date) : W} height={H} />
            </clipPath>
          </defs>
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i}>
              <line
                x1={X0}
                x2={X1}
                y1={y((i * ceiling) / 4)}
                y2={y((i * ceiling) / 4)}
                stroke="var(--border)"
              />
              <text
                x={X0 - 8}
                y={y((i * ceiling) / 4) + 4}
                textAnchor="end"
                className="fill-muted-foreground type-meta"
              >
                {number(Math.round((i * ceiling) / 4))}
              </text>
            </g>
          ))}
          <g clipPath="url(#growth-replay)">
            {groups.map((group, i) => (
              <g
                key={group.key}
                opacity={highlighted && highlighted !== group.key ? 0.15 : 1}
                className="transition-opacity duration-150"
              >
                <polygon
                  points={polygon(i)}
                  fill={departmentColor(i, group.key)}
                  stroke="var(--section)"
                  strokeWidth={1}
                  clipPath="url(#growth-past)"
                />
                <polygon
                  points={polygon(i)}
                  fill={departmentColor(i, group.key)}
                  stroke="var(--section)"
                  strokeWidth={1}
                  opacity={0.42}
                  clipPath="url(#growth-future)"
                />
              </g>
            ))}
          </g>
          {tickYears.map((year) => {
            const day = `${year}-01-01`;
            return day >= data.firstDate && day <= data.lastDate ? (
              <text
                key={year}
                x={x(day)}
                y={H - 6}
                textAnchor="middle"
                className="fill-muted-foreground type-meta"
              >
                {year}
              </text>
            ) : null;
          })}
          <line
            x1={x(date)}
            x2={x(date)}
            y1={Y0}
            y2={Y1}
            stroke="var(--foreground)"
            strokeWidth={1.25}
          />
        </svg>
      </div>
      {shown && !replaying ? (
        <div
          className="pointer-events-none absolute top-2 z-10 grid w-60 gap-2 rounded-menu border border-border bg-popover p-3 shadow-overlay"
          style={{
            insetInlineStart:
              locale === "ar"
                ? `calc(${100 - readoutPosition}% - 15rem)`
                : `${readoutPosition}%`,
          }}
        >
          <p className="type-label">
            {format.parts(shown.date, { month: "long", year: "numeric" })}
          </p>
          <p className="type-meta text-muted-foreground">
            {t("count", { count: shown.people.length })}
          </p>
          {groups
            .filter((group) =>
              shown.people.some((p) => departmentKey(p) === group.key)
            )
            .map((group) => (
              <p key={group.key} className="flex items-center gap-2 type-meta">
                <i
                  className="size-2.5 shrink-0 rounded-detail"
                  style={{
                    background: departmentColor(
                      groups.findIndex((g) => g.key === group.key),
                      group.key
                    ),
                  }}
                />
                <span className="min-w-0 flex-1 truncate">
                  {group.label ?? t("outsideDepartments")}
                </span>
                {number(
                  shown.people.filter((p) => departmentKey(p) === group.key)
                    .length
                )}
              </p>
            ))}
          <div className="border-t border-border pt-2">
            <p className="type-meta-strong">
              {t("joinedMonth", { count: joined.length })}
            </p>
            {joined.slice(0, 4).map((event) => (
              <p
                key={`${event.person.employeeKey}-${event.date}`}
                className="truncate type-meta text-muted-foreground"
              >
                {event.person.name}
              </p>
            ))}
            {joined.length > 4 ? (
              <p className="type-meta text-muted-foreground">
                {t("more", { count: joined.length - 4 })}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
