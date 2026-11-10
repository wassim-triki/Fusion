# B-390 — Design direction for Performance's explorers

Stage 3 of [B-390](B-390-performance-redesign.md), 2026-11-10. Read this before drawing any Performance screen. Scope is settled (`B-390-target-brief.md` §7b, decisions D-33–D-42 in `design/decisions.md`); `DESIGN.md` stays the authority for rules and tokens; Core HR's direction (`design/direction.md`) still holds and this file says what's specific to Performance: which way to lean, what to copy, what never to copy, and how the explorers go.

## 1. Where we're going

Performance looks and works like the rebuilt Core HR: the same people-first, warm, friendly product (BambooHR and Upwork in feel, modern and professional), one design language, D-32's colours. It's a module about a year people live through together, so every surface answers one question first: **what's next for me in this year?** And it's frictionless (D-40): whatever Fusion can know or compute, nobody types, ticks or waits for.

Bold where redesigned. The surfaces the user called garbage (the cycle page, Organization direction, Overview, the 1:1 page, calibration) get new structures from their job, not Core HR restyles of today's columns (`redesigns-bold-not-tweaks`). Cycle setup is liked: it keeps its grammar and gets polish.

## 2. What it means in Performance, concretely

1. **The next step leads.** Every page opens with the viewer's next step in this year, sized as the main thing, with its due date and one action; or with a calm "nothing for you now" and what comes next on the timeline. Status and numbers come after, never as a wall in front.
2. **The year is a thing you can see.** One timeline (Planning → Execution → Review → Results out) appears wherever the year matters, at the size the page needs: large on the Year page, a thin band on a goal or a review. Today's position on it is obvious; the next phase's step shows ahead. It moves on when something happens, with motion that says so (D-34).
3. **People, not records.** Plans, reviews and 1:1s are about a person and show them: a face, a name, their job. A manager's team reads as people with what each one needs (S1), never a roster table, unless comparing is the job (calibration's full view, HR's by-unit figures).
4. **Goals are objects with a line upward.** A goal looks the same everywhere (the plan, the company's map, the review, the person page): title in Lora when a person wrote it, the measure read as a sentence, a progress bar, status in its state colour, and its line up to the company's (G4 rung 3). The map is a view of the same objects, not a different drawing.
5. **Evidence beside, not behind.** Where a person judges (a review, a 1:1, calibration), what they need to judge sits beside the form on the same screen: goals with their grades, updates, feedback, praise, notes. A draft sentence opens its source in place (H3).
6. **Fusion's work is visible and quiet.** Computed things (weights, grades, flags, the phase, the next step) appear already done, marked quietly where a person might want to know why (the sparkle for AI, a small "from the measure" for a grade). Never a form field asking for what Fusion knows; never a disabled button with the reason in a tooltip (validation prevents, U6).
7. **Life from real events.** Praise with its reactions (the Hugeicons glyphs the user loves), a plan approved, a goal back on track, results out. Home, the Year page and the praise wall are made of these.
8. **Speak people.** One glossary with Core HR: "your plan", "put forward", "company goals", "your manager", "results". Never "cycle population snapshot", "scope owner", "contribution link", "exceptional approval", "calibration session facilitator" on screen.

## 3. Never this

Core HR's list holds (`design/direction.md` §3, `DESIGN.md` §9). Specific to what Performance does today:
- the cycle as an admin progress table, a milestone rail with nothing to do, tabs of status;
- a page that lands on status with no next step (the launch landing, the 1:1 page, calibration);
- grey buttons whose reason lives in a tooltip; a tick box that exists to unlock a save ("Discussed");
- AI as a field in the form or a big button; the coach as a separate panel you must summon;
- section headers with subtitles and decorative icons (the setup notes: "look like AI slop");
- right-column cards separated from the page by default (the user's note with D-32), restyled card columns;
- dot-strung stat lines, equal KPI tiles, pills sprinkled for colour;
- one module's own copy of a person, a team or Home.

## 4. References

**Use** (live through the shell, dark, 1440×900; capture them first into `plans/B-390-screens/reference/`):

| Surface | Why |
| --- | --- |
| Person page band (`/core/people/{id}`, D-01) | The design language: band, large photo, glance row, tabs in the band, unframed rail. Performance's tab lives here (S2). |
| Team page (`/core/team`, D-27, D-31) | Where the manager works (S1); its band, the team as a small chart, Coming up. |
| Home (D-09, D-12) | Needs you with approve in place (S3); Your year lives here. |
| Core HR's front page (D-30) | A hub with one main panel, a time slider and Replay: the closest precedent for the Year page's timeline and "the year replayed" (Y2 rung 3). |
| People org chart (D-17) | People-first cards, opens around you: the precedent for the goals map and the team's goals. |
| Change panel (B-139, D-15) | A sheet for a sectioned task with records: precedent for updating progress and adjusting a rating. |
| Brand studio (D-02), Fields (D-18) | Settings that preview live where they land: precedent for Performance settings (Y7) and starter content. |
| Cycle setup (`/performance/cycle/setup/*`) | Liked; keep its steps, date range and recap; polish per B-389. |
| Praise reactions (Feedback) | The glyphs the user loves (B-393). |

**The objective drawer** (details and update modes, `ObjectiveRecordSheet`; captured as `plans/B-412-screens/reference/objective-drawer*.png`) is a reference after all: the user liked most of it (3a round 2). Its grammar carries into 3b: the accent tile, the line upward as a card, properties as label and value rows, progress as one big figure with a bar, the update as the panel's own mode with a rail from baseline to target.

**Don't use as design reference:** every other Performance surface as built (Overview, the cycle page, Organization direction, My Plan's layout, the reviewer plan page, the 1:1 page, Reviews, calibration, Performance's person page). They are evidence of content and behaviour only. The October Performance references in `design/direction.md` §4 (My Plan, 1:1s, the alignment map) are superseded by the walk's verdicts; the map's interaction (expand, progress on nodes) may be reused, not its page.

**Outside** (structures, from the brief §3): Lattice's reviews with sources beside them; 15Five's manager help on the page where they act; Culture Amp's cascading goals with roll-up; HiBob's calibration worksheet; BambooHR for the friendliness bar and its few concepts.

## 5. Rules that hold, and what the explorers settle

Held: everything in `design/direction.md` §5; D-32's colours (dark page 0.215, cards 0.255, inlays 0.29, sidebar 0.2; light 0.975 / 0.993 / 0.958 / 0.965), drawn in the explorers even before B-370 applies them to the code; the foundation rules settled without a vote (`plans/B-397-foundation.md`: loading in the page's own shape, nothing under a second, tab switches load only what changes, quick actions apply at once with undo, long work with live counts, photos wherever a person appears, no em dashes, no dot-strung stats, plain words, no explaining sentences, validation prevents).

**Fusion-wide rules still open (B-397's leftovers), each settled in context**, where a real Performance screen needs it, drawn per situation with labels only:

| Rule (board) | Settled at |
| --- | --- |
| Navigation: modules, inside a record, steps of a flow (N1, N2, N4; B-381); N3 Settings is decided (one page with its own tabs) | 3a (the five places, a goal inside the Year), 3c (steps of the review round) |
| Type: where the serif goes (T1, B-377) | 3a |
| Empty: first use, a record's empty part, a fine-to-be-empty list, no results, no chart data, waiting on someone (E1–E7, B-376) | 3a (first use of the year, waiting on someone), 3b (lists, a record's empty part, a 1:1 with nothing to suggest) |
| Opening things: a quick look, a short task, a sectioned task, can't be undone, long work (P1–P5, B-373) | 3b (a goal's quick look, a progress update, praise), 3c (release, close the year, bulk finalize) |
| Icons: one set (I1, B-393) | 3d |
| Your menu (M1, B-338) | 3d |

Each settled rule becomes a decision (D-43 onwards) and a line in `DESIGN.md`.

## 6. How the explorers go

**Materials:** tokens from `Frontend/packages/ds/src/styles/tokens.css` with D-32's lightness; Geist and Lora from Google Fonts; Hugeicons as inline SVG; the DS's real shapes (DataTable bands, choice controls, the person band, the Team band). **Real data:** Carthage presets (`data/README.md`: `fresh`, `planning`, `midyear` and the later ones) read through the API; real names with roles (Amira Khelifi, the administrator; Mariam Gharbi, a manager; Aicha Bouazizi, an employee on Mariam's team); demo companies have photos (D-05). Dark first at 1440×900, a theme switch on the page. Labels only, no paragraphs; variants only where the choice is taste, combinations offered where options aren't exclusive (`ui-decisions-shown-per-situation`). Each screen asks the D-40 question: what does this person do that Fusion could have done?

**Checkpoints**, one session each (3a published 2026-11-10: [explorer](https://claude.ai/artifact/U5iCrbjucCuc8ZB6H81qhM), `B-412-style-frame.html`, db docs `frame/main` and `frame/round2`, recorded as D-43–D-60; 3b published 2026-11-10: [explorer](https://claude.ai/artifact/4nFFGFPJeoYnAF3nPzH3kd), `B-412-goals-conversations.html`, db doc `goals/main`):

| # | Screens | Interactive | Settles |
| --- | --- | --- | --- |
| **3a style frame** | Three anchors at full fidelity: **the Year page** (Amira right after launch: Planning, 0 of 92 plans, her next step "set the company's goals"; the same page for Aicha, her next step her plan; for Mariam, her team's plans), **Goals › You** (Aicha writing her plan: even weights, quiet coach suggestions, the line up to the company's), **writing a review** (Mariam on Aicha's: the year beside the form, grades prefilled, a cited draft). One quick question: is this the feel? | Switch viewer and phase on the Year page; the year moved on with its preview; a draft sentence opens its source | navigation, type, first-use and waiting states |
| **3b goals and conversations** | Goals › Company with the map, a goal's quick look and record, approval from Home and the Team page, a progress update, 1:1s (the meeting is the page, starter agenda, the calendar invite), Feedback with the praise wall | Expand the map; apply a coach suggestion; give praise | lists and empty parts, quick looks and short tasks |
| **3c reviews and the end of the year** | The round from the Year page (launch preview, progress by manager, nudges), self-review, peer input from Home, calibration by exception (flagged only; nothing flagged; the full view with the nine-box), release, results read and acknowledged, closing the year with carry-over | Keep or adjust a flagged rating; finalize what's ready | steps of a flow, can't be undone, long work |
| **3d across Fusion** | The Team page's Performance tab with the team's goals, the person page's Performance tab, Home's Needs you, HR insights against last year, Settings with previews, starter content and competencies by job, cycle setup polish (starter sets on the way, launch lands on the Year) | AI-drafted competencies applied one by one | icons, your menu |

After 3d: the slices, dependency-ordered and sized to a session each (B-412's last step), functions with their surfaces (B-392 and B-389 fold in).

## 7. Taste questions already known

To ask inside the explorers, each with a recommendation preselected:
- The Year page: timeline across the top with the next step under it, or the next step first with the timeline as its band?
- A goal's grade: "0.7" alone, or "0.7" with the measure's words ("7 of 10 clients")?
- The praise wall: a part of Feedback, or its own view on Home?
- How a computed thing is marked: the sparkle for AI only, or a quiet mark for everything Fusion filled in?
