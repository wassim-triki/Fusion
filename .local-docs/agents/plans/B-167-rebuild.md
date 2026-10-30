# B-167 — The rebuild, in slices

**Status:** Proposed 2026-10-30, waiting on the user's go before slice 1. Authority: `plans/B-164-decisions.md` (D-01–D-30), then the brief's §6b (scope), `DESIGN.md`, and the map (§4–§6) as evidence of what exists.

## Rules for every slice

- End to end: domain, contracts, every screen it names in every state (loading, error, empty), tests, against real data. One session each, fresh.
- One language and one design across surfaces (checkpoint 1); words per `DESIGN.md` (X1 is applied in every slice, swept in the last).
- New screen text in English, French and Arabic, lean (i18n speed mode).
- What a slice replaces is removed in that slice (redirects where links exist), not left beside it.
- Screens the explorer didn't draw (job catalogue, places, lists, checklist templates, sign-in settings, approval settings) are built in the accepted grammar (D-01, D-17, D-27) and judged at the slice's review.
- Ends with screens (dark, 1440×900) → In review; demo data extended through `data/` scripts as the slice needs it.
- Verification per AGENTS.md › Verification; `security-review` where marked.

## Slices, in dependency order

| # | ID | Slice | Builds (scope) | Decisions | Depends on | Replaces | Extra checks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | B-175 | **Jobs, places and the company's lists**: jobs as objects (family, level), places as a list, company lists (leave types, change reasons, employment types; a used value is retired, never deleted); assignments reference job and place, free-text titles and locations migrated (titles grouped into jobs); Performance's snapshot keeps its shape | O2 (2), O4 (1), C3 (1) | feeds D-15, D-22/23, D-25, D-28 | — | free-text title and location | migration (relational Up/Down); `@repo/api`, core, performance type-check |
| 2 | B-176 | **Brand studio**: logo, name, colour (from the logo, Fusion's, any, readable-text check), default language; applied across Fusion, sign-in and invitation emails; live preview of Home, sign-in and email, Arabic right to left; nothing changes until saved | C1 (2–3) | D-02, D-06, D-07, D-08 | — | read-only Settings › Company | journey; cold build |
| 3 | B-177 | **One roles model**: ten plain areas × level × reach, holders (everyone, anyone with a team, rules on department/job/place/unit that update themselves, chosen people), a person's roles together with why; access profiles and grants stay as storage, areas map to catalogue keys (Performance's included); screens: all roles as one table, a role page in sentences with a live preview of a real person's page | A2 (2) | D-25 | 1 | Settings › Roles | **security-review**; authz and cross-tenant negatives; rule recompute on job/unit change |
| 4 | B-178 | **Administrators, seeing as someone, old roles retire**: protected Administrators (everything, never fewer than two, password to add, only people who sign in, every grant kept, operators never inside); see Fusion as someone (read-only, recorded, banner); token-role copy and the old user/invitation endpoints retire from Identity and Core HR (Learning keeps its copy); B-173 verified first | A2 (2) | D-25 | 3 | `/core/access`, token roles | **security-review**; B-173 journey; continuity lock negatives |
| 5 | B-179 | **Changes and approvals**: describe a change in a sentence, Fusion drafts it from the company's jobs and reasons, the draft is the request, dated; approval per change type (off by default), one click from Home or the notification, a no needs a reason, HR's own apply at once; self-service sensitive changes use the same flow (withdrawable); Core HR's first work items on Home | L2, L3 (2), I2 (2), D4 | D-15, D-16 (requests) | 1, 3 | today's change sheet; absorbs B-168 | **security-review**; journey: manager proposes a promotion → HR approves from Home → applied on its date |
| 6 | B-180 | **One person page** across Core HR and Performance: band, glance row, tabs Overview · Job · Personal · Performance · Documents · Access, the rail; Personal sections with who sees each (locked fields without forms), Access (sign-in, roles and why, account history), documents on a person, on leave (dates and a type, shown wherever the person appears, Performance included); demo photos | P1 (2), P3 (1), P5 (1–2), A1 (2), D4 (2) | D-01, D-05, D-06, D-16 | 3, 5 | WorkerProfile layout, `/performance/people/{id}` | cold build; journey: employee edits, HR approves |
| 7 | B-181 | **Fields**: company fields and sections by where they show, who sees and who changes each, a gallery added in one click, live preview on a real person, job fields only through dated changes; records to complete; demo companies ship a set | C2 (2 + gallery), P4 (2) | D-18 | 3, 5, 6 | TenantSettings' eight fixed fields | migration; journey |
| 8 | B-182 | **People, the directory and invitations**: People for HR (faces, views, Sign-in column, filters on the company's fields, Add people), portrait cards for everyone else with an A–Z rail; the invite sheet (who, when, first-day invitations, reminders, branded email preview); Settings › Sign-in; one Export in the table kit (CSV, Excel, as filtered, only what the viewer may see) | P2 (2), L1 (2), D5 (1+) | D-11, D-13, D-28 | 2, 6, 7 | Workforce access page, Settings › Invitations | cold build; journey: invite later, reminder, first-day invitation |
| 9 | B-183 | **Organization in time**: one Organization place, People view (the org chart as built), Structure and List views, one time slider (past from real dates, future from planned changes, marked and listed), a page per unit, open roles | O1 (3), O3 (2) | D-17, D-20 | 1 | separate Organization and Org chart entries | cold build; as-of journey |
| 10 | B-184 | **Joining and leaving**: checklists from company templates for HR, the manager and the person, due from the first or last day, made on hire and end, tasks in Needs you; a joiner's first day is their first week; celebrations (work anniversaries, birthdays if the person opts in, day and month only) | L4 (2), D1 (2) | D-12 (joiners), D-27 (first week) | 5, 6 | absorbs B-146 | journey: hire → checklist → done |
| 11 | B-185 | **Team page**: the person page's grammar for a team (the team as a small chart with what's next for each), tabs Overview · Performance (My Team moved in, unchanged inside) · Org chart, rail, Coming up (30 days), the joiner's first week, the team's year | D3 (1–2) | D-19, D-27 | 6, 10 | `/core/team`, `/performance/team` as an entry | cold build |
| 12 | B-186 | **The import, one flow**: one session for any number of files on the organization import's platform; files recognised by what they hold; units, people, jobs and places resolve against each other; Drop · What Fusion understood (the labelled sheet, questions with Fusion's lean) · the chart (People, Units, Jobs; fixes in words beside what the file said) · Bringing in and Brought in as one frame; AI kept quiet and never deciding success; fingerprinted bring-in | I1 (3) | D-22, D-23, D-24, D-29 | 1, 8, 9 | both import flows' screens | relational; journey on the demo files; scale run |
| 13 | B-187 | **The import, again and when it goes wrong**: create or update (matched by employee number or work email: new, changed, not in the file, dated), resumable batches that never double anyone, Stopped partway with Try again from the row, bad files that say what's wrong and the one thing to do | I1 (3) | D-22, D-23, D-29 | 12 | create-only | relational; journey: import, change file, import again, stop and resume |
| 14 | B-188 | **Day one and Home**: activation with "Do you work at <company>?"; Home on day one (setup guide with the import's drop and chart in its open step, company card, People), built as the tour's administrator track for B-090; Home every day for every role (Needs you across modules, Coming up, Your year, Praise, Your team); navigation collapses to icons | F1 (2), F2 (2), D1 (2) | D-03, D-04, D-09, D-10, D-12 | 2, 4, 8, 10, 12 | Core HR "Getting started" | cold build; journey from a new tenant's invite |
| 15 | B-189 | **Reports**: the standard set and your own (fields incl. the company's, filter, group, chart, save, share with a role, export), on a date or between two, run as the viewer | R1 (2) | D-14 | 3, 7 | — | **security-review** (what a report can show) |
| 16 | B-190 | **Core HR's front page**: header, Growth and People views on one time slider with Replay, department cards following it, next 30 days, records to complete, open roles; from the reports engine | D2 (2) | D-30, D-20 | 9, 15 | Core Overview (dashboard) | cold build |
| 17 | B-191 | **Single sign-on**: Microsoft and Google; a company's own Entra ID or OpenID Connect in Settings › Sign-in, tested, required for its email domain; invited people only; a local test provider for development and tests | S1 (2) | — | 2, 8 | — | **security-review**; journeys with the test provider |
| 18 | B-192 | **Seams and finish**: colleague modules only when the company has them on (joining checklists replace Onboarding); one vocabulary swept across every surface; every replaced surface gone (map §3); demo presets rebuilt through the API with the explorer's stories for the tour | X1 (2), Q3 | — | all | — | full suites once; screens of the whole journey |

## Recommended effort per session

Set by hand when the fresh session starts. xhigh where a mistake is silent and costly (security boundaries, data integrity, the import engine); high for domain work with crafted screens; medium for composition over data that already exists, and sweeps.

| # | Slice | Effort | Why |
| --- | --- | --- | --- |
| 1 | B-175 Jobs, places, lists | high | migration off free text across contracts; tested by the relational suite |
| 2 | B-176 Brand studio | high | crafted screens, theming across apps, branded sign-in before authentication |
| 3 | B-177 One roles model | xhigh | the authorization model everything else checks |
| 4 | B-178 Administrators, see as someone, old roles retire | xhigh | privilege boundary, impersonation, removing old checks without opening a hole |
| 5 | B-179 Changes and approvals | xhigh | dated changes on the temporal model, approval authorization, AI drafts |
| 6 | B-180 One person page | high | big composition, visibility per section, documents |
| 7 | B-181 Fields | high | field model with visibility, migration of the fixed fields |
| 8 | B-182 People, directory, invitations | high | export that respects visibility, scheduled invitations |
| 9 | B-183 Organization in time | high | as-of reads past and future, time slider |
| 10 | B-184 Joining and leaving | medium | checklist templates and generation, standard shape |
| 11 | B-185 Team page | medium | composes the person page grammar, Coming up and My Team |
| 12 | B-186 The import, one flow | xhigh | merging two engines, cross-file resolution, AI kept honest |
| 13 | B-187 The import again | xhigh | create or update and resumable batches that never double anyone |
| 14 | B-188 Day one and Home | high | activation in Identity, the guide, aggregation across modules |
| 15 | B-189 Reports | xhigh | queries over dated data that must show only what the viewer may see |
| 16 | B-190 Core HR's front page | high | visual craft (two views, Replay, cards) on the reports engine |
| 17 | B-191 Single sign-on | xhigh | authentication with outside providers |
| 18 | B-192 Seams and finish | medium | sweep and demo data |

## Why this order

- Jobs, places and lists first: roles' rules, changes, fields, the directory and the import all read them, and moving titles off free text touches every later screen.
- Brand early: Make it yours shines first, and the invite sheet, Home's company card and activation show the logo and colour.
- Roles before anything that decides who sees what (person page, fields, reports); administrators and the token-role retirement right after, so no later slice builds on the old checks.
- Changes before the person page: Personal's requests and Job's history use them.
- The import after the objects and pages it fills (jobs, people, Organization); Home after the import, since its setup guide opens on it.
- Reports before the front page, which draws from them.

## Open questions

None yet; the order waits on the user's go.
