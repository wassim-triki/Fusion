# B-190 — Core HR’s front page

**Status:** Accepted ✓ 2026-11-04 (user: "looks good enough"), after the review pass below. Slice 16 of B-167.

**Review pass, 2026-11-04 (batch 1):** compared live with the D-30 drawing and fixed: the 16 people who sit in a division's own team or at company level showed as "Unassigned" first, with a colour shared with another department. They now form **Not in a department**, last, neutral grey in the chart, the card listing the units they sit in (the API sends their own unit as `parent`). Six distinct department hues (new `--identity-6`). Time here no longer cuts "Less than a year". Next 30 days rows drop the redundant "Core HR" source. Consulting −11 and Product −8 "in a year" are real: the 27 Oct reseed (B-125) moved those teams into their division's own unit. CoreHR 470/0/0, core touched tests 16/0/0, type-check pass.

Authority: D-30 / D-20 in [accepted decisions](B-164-decisions.md), drawing in `B-164-explorer-3c.html`.

## Look at

Open [Core HR](http://localhost:3000/core) as Amira Khelifi, the Carthage administrator. Dark, 1440×900.

- Growth opens first, with the company header, monthly departmental history and faded planned future. Hover a month for the population and joiners; department cards follow that date and highlight their chart layer on hover.
- Switch to People. Regroup by Department, Place or Time here. The date stays the same; the slider, Today and Replay drive both views.
- Below the department cards: Next 30 days, Records to complete and Open roles. Expand a missing detail to open the affected records.

Screens inspected against the drawing: [Growth](B-190-screens/01-growth.png), [People](B-190-screens/02-people.png), [Coming up and records](B-190-screens/03-coming-up-and-records.png).

The groups come from the real dated structure: D-30’s six Division-level departments, above Carthage’s Department A/B units. Companies without Divisions use Department; without either level they use Reports’ grouping. People outside these groups remain Unassigned. Missing-detail rows expand into named records rather than the drawing’s “Ask them” action. Open roles follow Reports’ current-plan rule. Real photos are reused; initials remain where none exist (demo photos stay B-230).

## What changed

`GET /api/corehr/reports/front-page` projects Reports’ same scoped dated rows. Monthly points plus actual employment, work, manager and unit boundaries support day-based scrubbing and local Replay. The private projection is not capped by the report builder’s 120-column limit. Existing Reports grants, the viewer’s current branch and the field whitelist apply before results are returned.

Required details reuse the Fields checker, limited to active allowed people and visible fields, with separate Personal/Job audiences. Required source Personal fields now count there too. Old overview dashboards are removed; viewers without Reports enter their team, profile or operational workspace. EN/FR/AR, shared TimeBar, Segmented, Section, PersonAvatar and upcoming rows. Sidebar B-250/B-274 and Add a person B-239 untouched.

## Verification

Counts below are passed / failed / skipped. Frontend commands run from `Frontend/` unless noted.

| Command | Final evidence |
| --- | --- |
| `pwsh -File .agents/skills/fusion-dev/scripts/test-backend.ps1 CoreHR` | **454 / 0 / 0**, relational enabled, after the final grouping regression. |
| `pnpm --filter core exec vitest run src/features/overview/model/front-page.test.ts src/features/overview/components/front-page.test.tsx src/features/overview/components/people-view.test.tsx --maxWorkers=2` | **8 / 0 / 0**. Shared-date behavior, exact boundaries, whole history, regrouping, field visibility, actual face-wall tooltip context, upcoming people and incomplete records. |
| `pnpm --filter @repo/api type-check` | 1 check passed; 0 failed. |
| `pnpm --filter core type-check` | 1 check passed; final cold build also validates all final frontend types. |
| `pnpm --filter core lint` | No errors. Final cold build shows only 6 existing B-276 warnings. |
| `pnpm --filter core build` | Passed, 22 static pages generated; final lint/types passed. |
| `node Frontend/apps/core/scripts/check-messages.cjs` (repo root) | EN/FR/AR keys match. |
| `node .local-docs/agents/data/journey-b190-front-page.cjs` (repo root) | **10 / 0 / 0** after final restart. Anonymous/no access refusals, historical/future manager branch, required-record scope, other tenant, field policy and count parity with Reports. |
| `node .local-docs/agents/data/screens-b190-front-page.cjs` (repo root) | **8 / 0 / 0**, dark 1440×900 through the shell. Hover and joiners, regrouping, past population, Today, Replay, no horizontal overflow or uncaught page errors. Three final surfaces inspected. |
| `git diff --check` | Passed. |

The real face-wall regression covers the TooltipProvider issue caught during rendered QA. The scoped-history backend fact covers Division-level grouping above Department A/B. Existing no-photo lookups return 404 and render initials, as before.

Security review: claims remain the only authority; tenant query filters stay in place; the current Reports branch is resolved before people load; optional fields, open roles and missing details retain viewer policy. No raw HTML or user-controlled query/URL construction added. No high-confidence vulnerabilities identified. Permission and isolation checks passed against the live shell.

The local stack remains running with shell/core frontends. No staging, commit or push performed.
