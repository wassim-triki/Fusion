# B-211 Top bar search: design

Explorer: [artifact](https://claude.ai/artifact/4nuqMWcJkD1EcxnVXcTFhg), source [B-211-explorer.html](B-211-explorer.html) ( Carthage's 100 people read 2026-11-06, seen as Amira Khelifi the administrator, Mariam Gharbi a manager, Aicha Bouazizi an employee). Built by a scratchpad script from the live API; no data changed.

## Proposal (recommended options preselected in the explorer)

- **Shape:** a palette over the page (Ctrl/⌘ K or a click on the field), list on the left, a preview of the highlighted result on the right. Alternatives drawn: drops from the bar (no preview, actions under the highlighted person), faces first (people as cards).
- **Before typing:** your people as faces (manager, then reports or teammates), the last three things opened, four places.
- **Results, in order:** Do (only when the query starts with a verb: "praise mariam", "feedback omar", "1:1 aicha", "hire"), People (5, then "See all N people for …" into People), Teams and places, Jobs (administrators), Performance (objectives, 1:1s, review rounds, cycle, saved reports, per rights), Pages. Scope chips with counts once something is typed.
- **People rows:** initials in identity hue, name, job and team, place; "Your manager", "On your team", "Reports to you" beside the name.
- **Preview of a person:** team, place, manager, leads (face pile), joined, email; Open their page (Enter), Show on org chart, Give praise, Ask for feedback, 1:1s (their manager), Propose a change (their manager, administrators). Hide what the role can't do.
- **Matching:** word starts across name, job, team, place, employee number, email; accent and case insensitive.

## How it would work

- Core HR: one new viewer-scoped read for people, units, places and jobs, scoped like `org-chart/search` (`OrgChartSearchQuery`). Performance: one read for objectives, 1:1 series, review rounds the viewer can open. The shell calls both in parallel, debounced; a module that's down just loses its group.
- Pages and actions from the viewer's rights already in the shell (`visibleFusionModules`). Recent items in localStorage per user and company.
- Tests: scope per role for each read, cross-tenant negative.

## Build recipe (cold pickup)

Accepted 2026-11-06 ("good, this is it, let's have it"). One session, one commit; high effort (it's authorization: run `security-review`). Port the explorer closely: open it beside the build, shape B with the colours below.

1. **Core HR read** `GET /api/corehr/search?q=` → people (key, name, initials, job, unit, place, manager key, photo), units, places, jobs (jobs only with catalog rights). Same viewer scope as the org chart's search (`Features/OrgChart/OrgChart.cs`, `OrgChartSearchQuery`); word-start, accent- and case-insensitive over name, job, unit, place, employee number, work email; people capped (5 + total), others small. Relationship ("your manager", "on your team", "reports to you") computed server-side from the viewer's employee. Tests: scope per role (Amira administrator, Mariam manager, Aicha employee), cross-tenant negative, no-employee viewer.
2. **Performance read** `GET /api/performance/search?q=` → objectives the viewer may open (the one objective access policy, `ObjectiveAccessTests`), 1:1 series they're in, review rounds they manage or HR. Tests: scope per role + cross-tenant.
3. **Shell** `Frontend/packages/auth/src/components/top-bar-search.tsx`: replace the CommandDialog with the drop-down on the field (field widens to 640, panel on its edges, bands on the icon edge), debounced parallel calls to both reads (a failed module drops its group), pages and verbs from the viewer's rights (`visibleFusionModules` + capabilities), recents in localStorage per user and company, before-typing faces/recent/places, scope chips with counts, keyboard (↑↓, ↵, → ← into action icons, Esc, Ctrl/⌘ K), hues from one map. Actions open the existing flows (praise, feedback request, 1:1s, change panel, org chart focus). Messages in en/fr/ar. Update `top-bar-search.test.tsx`.
4. Checks: both services' suites, `@repo/auth` tests, one API journey script in `data/` for the scope negatives, one screen (dark, 1440×900) compared with the explorer.

## Picked (user, 2026-11-06)

- **Drops from the bar**, aligned to the field's edges (panel left/width = the open field's; every band starts on the field's search-icon edge).
- **Actions on the highlighted person as icons**, not text: org chart, praise, feedback, 1:1s, change (per rights), shown only on that row; pointing at one (or → / ← from the keyboard) names it in place of the row's job line; Enter runs it. User: "should be more clean, no need for much text".
- **Colour** (user: "introduce some color … clean and deliberate and noticeable"): one hue per kind, the same everywhere, from `--identity-*` and the semantic tokens. Result wells tinted at rest (teams teal, places green, jobs blue, goals amber, reviews pink, 1:1s violet, reports blue); action icons neutral until pointed at, then their hue fills the icon's well and colours the row's line that names it (org chart teal, praise pink, feedback blue, 1:1s violet, change amber). Names, people rows and the frame stay neutral. Accepted ("perfect") before this change; colour pass sent for a look.
- Before typing, actions, relationship words: the recommended answers unless the user says otherwise (their recorded answers on the page weren't saved, the page keeps no state).
