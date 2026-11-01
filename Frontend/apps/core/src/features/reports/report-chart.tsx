"use client";

import type { ReportRunDto } from "@repo/api";

export const seriesColor = (index: number) =>
  `var(--identity-${[1, 2, 4, 3, 5][index % 5]})`;

/** The explorer's stacked bars: shared scale, quiet grid, totals above each period. Rates and tenure use grouped bars. */
export function ReportChart({
  run,
  labels,
  title,
}: {
  run: ReportRunDto;
  labels: string[];
  title: string;
}) {
  const width = Math.max(836, run.periods.length * 70);
  const height = 250,
    left = 36,
    bottom = 214,
    top = 24;
  const stacked = run.unit === "people";
  const max = Math.max(
    1,
    ...run.totals,
    ...run.series.flatMap((s) => s.values)
  );
  const ceiling = Math.ceil(max / 4) * 4;
  const y = (value: number) => bottom - (value / ceiling) * (bottom - top);
  const band = (width - left - 8) / run.periods.length;
  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full min-w-[720px]"
        role="img"
        aria-label={title}
      >
        {Array.from({ length: 5 }, (_, i) => (ceiling * i) / 4).map((n) => (
          <g key={n}>
            <line
              x1={left}
              x2={width - 8}
              y1={y(n)}
              y2={y(n)}
              stroke="var(--border)"
            />
            <text
              x={left - 8}
              y={y(n) + 4}
              textAnchor="end"
              className="type-meta fill-muted-foreground"
            >
              {n}
            </text>
          </g>
        ))}
        {run.periods.map((period, index) => {
          let base = 0;
          const x = left + index * band + band / 2;
          const barWidth = Math.min(46, band * 0.6);
          return (
            <g key={period.to}>
              {run.series.map((series, k) => {
                const value = series.values[index] ?? 0;
                const start = stacked ? base : 0;
                base += value;
                const w = stacked
                  ? barWidth
                  : barWidth / Math.max(1, run.series.length);
                return (
                  <rect
                    key={series.key}
                    x={x - barWidth / 2 + (stacked ? 0 : k * w)}
                    y={y(start + value)}
                    width={w}
                    height={Math.max(0, y(start) - y(start + value) - 2)}
                    rx="3"
                    fill={seriesColor(k)}
                  >
                    <title>{`${series.label}: ${value}`}</title>
                  </rect>
                );
              })}
              <text
                x={x}
                y={
                  y(
                    stacked
                      ? base
                      : Math.max(
                          0,
                          ...run.series.map((s) => s.values[index] ?? 0)
                        )
                  ) - 8
                }
                textAnchor="middle"
                className="type-meta-strong fill-foreground tabular-nums"
              >
                {run.totals[index]}
              </text>
              <text
                x={x}
                y={height - 14}
                textAnchor="middle"
                className="type-meta fill-muted-foreground"
              >
                {labels[index]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
