# B-390 — Performance, as built (2026-11-09)

Stage 1 of [B-390](B-390-performance-redesign.md). **Facts only, no verdicts**; verdicts come in the explorers. The user's own reactions from the walk are quoted as evidence, not as decisions. Questions the scope and the design must answer are collected at the end.

**Sources:** code at `5da8983f` (`wassim/develop`); the B-331 walk on 2026-11-09 with the user driving (`design/walkthrough-2026-11-09.md` §7, company "Carthage Digital · Walkthrough 202611082348": Amira Khelifi, the administrator; Mariam Gharbi, a manager; Aicha Bouazizi, an employee on Mariam's team); the board's B-392 (functions) and B-389 (cycle setup). Product authority until the new decisions exist: `archive/plans/B-068-decisions.md` (Performance's D-01–D-41, accepted 2026-10-15) and `B-069-surface-architecture.md` (S-01–S-16). The Core HR design decisions (`design/decisions.md`, D-01–D-31) are the visual language the rebuild follows.

## 1. How it was built

- Rebuilt from first principles in October (B-065): catalogue → decisions (B-068) → surface architecture (B-069) → six slices (B-070, 2026-10-15 to 10-22), then a cross-slice polish (B-089), settings (B-071), French and Arabic (B-119/B-115).
- All of it predates the Core HR rebuild's design language (B-164/B-166, from 2026-10-30): the person-page band grammar, Home "your day", the surface tone ladder as applied in Core HR, the explorer-first process. Performance had a hand pass planned (B-104) that never ran; since then only fixes (e.g. B-228 replaced My Plan's objective cards with rows on 2026-11-08; the cards were restored mid-walk, `3f5f20fe`).
- Size: frontend `apps/performance` 254 TS/TSX files, ~42.9k lines, 31 routes. Biggest files: `goals/objective-workspace.tsx` 1509, `team/team-direction.tsx` 1277, `goals/org-objective-composer.tsx` 1136, `reviews/review-record-page.tsx` 988, `one-on-ones/series-record.tsx` 864, `plan/goal-composer.tsx` 820, `overview/overview-rows.tsx` 770, `conversations/feedback-workspace.tsx` 759, `team/your-people.tsx` 721. Backend `EY.HRPlatform.Performance` 204 C# files (no migrations counted), 20 controllers.
- Icons: Hugeicons through `src/lib/icons.tsx` adapters (Core HR, shell and `@repo/ds` use Lucide).

## 2. Navigation as built

Shared `FusionSidebar` frame. Primary: **Overview** `/`, **My Plan** `/plan`, **1:1s** `/one-on-ones`, **Feedback** `/feedback`, **Reviews** `/reviews`, each gated by the server's workspace destinations. Administration: **Cycle** `/cycle` (cycle administrators), **Settings** `/settings` (switches the sidebar to settings mode). **Organization direction** `/goals` is deliberately not in the sidebar (reached from Overview, Team, objective records; S-15). 1:1s, Feedback and Settings ignore the cycle switcher; the rest carry `?cycle=`.

Team for managers is Core HR's Team page (`/core/team`), whose Performance tab is Performance's `/team`: a full navigation between apps, the shared TeamBand redrawn on each side.

## 3. Surfaces

| Route | What it is | Walk (2026-11-09) |
| --- | --- | --- |
| `/` Overview | Year band, then one row per responsibility in a fixed order (cycle, team or reviews you write, own review and plan, input owed, development, conversations, direction), composed by the server | "not reliable for now. I can't trust it" |
| `/cycle/setup/details`, `/population`, `/review` | Guided setup: Details (name, dates, timeline, at a glance) → Population (scope from Core HR, people in scope, needs attention, exclusions) → Review (recap, Launch) | Liked: "something I'm proud of". Notes in B-389 |
| `/cycle` | The established cycle, read-only: header with phase and Close cycle, tabs Status (milestone rail, closure) and Insights (fact strip, by unit, company direction, by manager, people drawer) | After launch it lands here: "abysmal", nothing says what to do next |
| `/goals` | Organization direction: objective workspace per scope (company, units), org objective composer (modal), alignment map, publish Draft → Published | Not found from anywhere; typed by hand. "I don't think we can save this … absolute garbage" |
| `/plan` | My Plan: objectives (cards), weights, measures, AI coach, development section, change requests, plan rail, submit | Cards restored mid-walk; coach "works … don't know if I'd keep it working like that" |
| `/cycles/{c}/plans/{p}` | A plan as its reviewer sees it: approve, return with per-objective requests, exceptional approval | Approved in the walk |
| `/cycles/{c}/objectives/{o}` (+ `@record` sheet) | Objective record: summary, measurement, progress, status, contribution, alignment, aligned children, feedback | |
| `/team` | Team's Performance tab: TeamBand, team summary and results, Your People roster, team direction | "No one reports to you" for Mariam, who has reports (B-383) |
| `/one-on-ones`, `/one-on-ones/{series}` | Series per manager and report: start (cadence, first agenda with suggestions), meetings, agenda, shared and private notes, action items | "I don't really know what I'm doing inside the 1:1 page"; empty first suggestions unexplained |
| `/feedback`, `/feedback/requests/{id}` | Feedback (give, request, answer), praise (values, reactions) | Praise blocked: no values in a new company; the icons "I love" |
| `/reviews`, `/reviews/{id}`, `/reviews/peer-requests/{id}` | Reviews workspace, a review (self, manager, items as boxes, AI draft), peer requests | Self and manager reviews done |
| `/reviews/rounds/new`, `/reviews/rounds/{id}` | Round setup (one page), round status, finalize, close | Release done; the round stays open |
| `/reviews/rounds/{id}/calibration` | Calibration: distribution, people by rating, nine-box, adjust drawer with reason and "Discussed", finalize dialog | "I have no clue what this calibration thing is" |
| `/people/{employeeId}` | Performance's own person page: the same summary as Core HR's Performance tab | |
| `/settings/{section}` | Rating scale, competencies (also the praise values), review questions, cycle defaults (planning, reviews, conversations, AI and data), notifications | Values added here to unblock praise |

## 4. Domain as built

- **Cycle:** Draft → Active → Closed; one active cycle at a time; population confirmed and frozen at activation (snapshot); deliberate close. Settings hold defaults copied at creation.
- **Phase** (`CycleDetailComposer.PhaseAsync`): an Active cycle is Planning until the planning deadline, then Execution; Review while any review round of the cycle is Active, whatever the date; Draft and Closed have none. Used by the cycle page, the workspace context and the person summary.
- **Objectives:** company → unit → employee cascade; three measurement methods (percent, numeric baseline → target with an explicit `ImprovementDirection`, milestones); contribution links; plan alignment policy; scope owners publish org objectives.
- **Plans:** draft → submit → approve or return (per-objective change requests) + exceptional approval; update requests; progress updates with status (On track / At risk / Off track with a reason) and evidence uploads.
- **Development plan:** 1–5 growth goals per person per cycle, carry-over.
- **Conversations:** 1:1 series (cadence, agenda with computed suggestions, shared and private notes, actions), feedback (shared or manager-only, requests to 1–5 people), praise (one value from the competency catalogue, reactions).
- **Reviews:** rounds with components (self, peer, objective ratings, competencies, potential, questions, calibration), snapshot at launch, one active round per cycle; lifecycle self → manager → calibration → ready → finalized and released; acknowledgement; PDF; history.
- **Calibration:** one session per round; facilitators; adjust with a reason; "Discussed" marks; insights computed (leniency, rating vs outcome, big moves); finalize only when no review of the round is outstanding (`OutstandingAsync`).
- **AI:** objective coach, review draft and self-reflection starter on the shared Groq transport, tenant switch, audited, labelled.
- **Notifications:** outbox → in-app + email per transition, grouped (plans and goals, …), with preferences; `DevelopmentGoalAdded` fires while the plan is still a draft.

## 5. Roles and permissions as built

Capabilities composed on the server, never personas (D-R1): participant, manager (direct reports from Core HR), scope owner, cycle administrator, calibration facilitator; Core HR's Roles model (B-177) carries Performance's areas. Workspace destinations gate navigation; resource policies gate every read and write; tenant isolation on the server. Not under review here: the walk found no authorization defect in Performance.

## 6. Seams with Core HR and the shell

- **Population** from Core HR (units, managers, employment) at activation; the walk's 8 "need attention" traced to the import (B-391, fixed).
- **Person page:** Core HR's Performance tab renders `GET /api/performance/people/{id}/summary`; Performance also has its own `/people/{id}` page with the same summary.
- **Team page:** Performance tab = `/performance/team` (full navigation); Core's Team overview links 1:1 series and praise.
- **Home:** setup guide step 5 "Start Performance", Your year, praise feed, Needs you (work items from `GET /api/performance/work`).
- **Bell:** Performance notifications merged by the shell. **Search:** cycles and objectives in the top bar.
- **Settings:** one Settings place; Performance's sections inside it.

## 7. The walk, Performance part (the user's words, shortened)

- Setup Details: "not bad at all … something I'm proud of"; the section subtitles and icons on Cycle details, Timeline, At a glance "look like AI slop". The date range works (unlike Reports'). Next flickers and reloads the step before moving on.
- Population: photos missing (avatars only); "All active employees" by default, 92 in, 8 need attention; Reviewer avatar drawn differently from Employee's.
- Review: Continue clicked by hand after confirming exclusions; launch lands on the cycle page, "abysmal"; "nothing tells me what to do"; Organization direction found only by typing `/performance/goals`.
- Organization direction: "I don't think we can save this … the front end of the Performance module is absolute garbage. … since the moment we clicked confirm on that cycle, it's been nothing but embarrassing." A Direction field beside baseline and target "doesn't make sense … the baseline and the target should determine the direction".
- My Plan: the cards she had built were gone (B-228; restored). The AI coach works, its form is open. Mariam got two notifications: a development goal added while drafting, then the submitted plan.
- 1:1s: no suggested first agenda (none to suggest: no risks, requests or feedback yet), unexplained; "I don't really know what I'm doing inside the 1:1 page".
- Praise: button grey, no reason (no company values); values added in Settings › Competencies, then it worked. The Hugeicons in the praise card are loved (B-393).
- Calibration: "no clue what this calibration thing is"; "Discussed" had to be ticked before saving; Finalize stayed grey (waits for all ~92 manager reviews; the reason only in a tooltip).
- After release the cycle still reads Review (the round stays open until closed); after closing the round, Planning again (dates only).
- Overview: "I can't trust it. We'll have to rework the whole thing", by the same process as Core HR "so everything stays in our context … and we don't end up with isolated reworks".
- The user's rule: functions that are broken or misused (B-392) are a separate thing from the visual rework; both happen, decoupled.

## 8. Functions that are broken, missing or misused (B-392, B-389)

1. Praise can't be sent in a new company (a value is required, there are none, the button gives no reason).
2. (D) Drafting steps notify the manager (development goal added before submit).
3. Calibration can't finalize while any manager review is outstanding; the reason is a tooltip. (D) whether HR may finalize and release what's in. "Discussed" required to save a kept rating, unexplained.
4. After release the cycle reads Review until the round is closed by hand; nothing says to close it.
5. (D) After the round closes the phase goes back to Planning (dates only), whatever happened.
6. Team's Performance tab says "No one reports to you" to a manager with reports (B-383).
7. Measures ask for a Direction that baseline and target already give.
8. Cycle setup: Next flickers and reloads the step; Continue to Review by hand after exclusions; Reviewer avatar differs from Employee's; photos missing (B-382).
9. After launch nothing leads to the next step (organization direction).

## 9. Questions the scope and design must answer

1. **The year's page.** What is `/cycle` for once the cycle runs, and is Overview a separate page from it? Who opens each, and what do they need next?
2. **Phase.** Does the phase follow dates or what happened (plans approved, round launched, results released, round closed)? Can HR move it on deliberately? (Also decides how a year is demoed in one sitting, B-395.)
3. **Direction's place.** Where does the company's direction live, and how does HR find it after launch?
4. **The manager's place.** Team's Performance tab, Performance's own pages, Home: which one is where a manager works?
5. **One person page.** Does Performance's own `/people/{id}` stay beside Core HR's Performance tab?
6. **Conversations.** What should a 1:1 page lead with so a manager knows what to do; what does a first meeting with nothing to suggest show?
7. **Calibration.** How does the page explain itself, and may HR finalize part of a round?
8. **Values.** Are praise values the competency list, their own list, optional, or seeded?
9. **AI.** Which shape for the coach (inline, on request, plan drafting); how far the review draft goes.
10. **Notifications.** Which moments deserve a notification (drafting steps?).
11. **Visual language.** Do Performance's records take Core HR's band grammar (D-01), and which Fusion-wide rules (B-397: colours, empty states, loading shapes, icons, navigation) hold before any screen is drawn?
