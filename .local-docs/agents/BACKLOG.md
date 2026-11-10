# BACKLOG — the board

Open work only. Agents keep it current from the conversation; closed items leave the board and live in `LOG.md`.

| Lane | Meaning |
| --- | --- |
| In progress | An agent is on it (mirrors `STATE.md` Active work). |
| In review | Done, but only a human eye can tell if it's right. Says what to look at. |
| Ready | Agreed and actionable, in priority order. |
| Needs discussion | Not actionable until talked through. |

**Items**

```md
- [ ] **B-NNN** One-line outcome · Area · YYYY-MM-DD
      Context, evidence or "Look at: …" on indented lines. Links: [plan](plans/B-NNN-slug.md)
  - [ ] **B-NNN** A concrete piece of the parent
```

- **Hierarchy:** a parent is an outcome the user would recognise; children are its pieces. Two levels by default, three only when it helps. Agents split, merge, reparent, reorder and retitle freely; IDs never change.
- **IDs:** unique, never reused; next is one above the highest ever used (check `LOG.md`). **Next ID: B-419.**
- **Review gate:** only noticeable, judgment-dependent work goes to In review. Evidence-settled work (backend, refactors, config, small or as-asked fixes) closes straight to `LOG.md` with ○.
- **Closing:** user approval in conversation (or a ticked box) closes ✓; a complaint becomes a Ready child and the parent stays In review.

## In progress

None.

## In review

- [ ] **B-399** Core HR functions the walk found broken or missing · Core HR, Identity · 2026-11-09
      Parent: B-396 (Stack 2 · Core HR › Functions). Built 2026-11-10; only the hand can judge the three below, the rest is settled by tests (LOG).
      Look at, as Amira in the walkthrough company (`amira.khelifi@walkthrough-202611082348.example.test`, local password), http://localhost:3000:
      - Organization › People, drag the date slider and press Replay: the thumb and date follow the hand, the chart catches up as each date loads (no page loading bar). Aicha shows on leave from 16 November.
      - Aicha › Make a change, type "promote Aicha to Senior QA Automation Engineer on 1 December": the Job row says there's no such job yet with Add it; the footer says why Save is grey until then.
      - Reports › Between: each click moves one end (a day before From moves From, after To moves To, inside the nearer one); neither clears the other.

## Ready

### After the walkthrough (B-331): three stacks

From B-331's walk (2026-11-09; the user's words, step by step, in `design/walkthrough-2026-11-09.md`; the B-numbers on notes trace to them). One item per surface: notes are evidence for rethinking the surface as a whole, not a list of fixes; functions sit apart from visuals. (D) = needs discussion.

- [ ] **B-390** Stack 1 · Performance redesigned as a module, functions and visuals together · Performance · 2026-11-09
          Map done 2026-11-09 (session 2): [plan](plans/B-390-performance-redesign.md), [map](plans/B-390-map.md). Scope settled 2026-11-10 (checkpoint 2): [target brief](plans/B-390-target-brief.md) §7b, decisions D-33–D-42 in `design/decisions.md`; the user's word over everything: remove friction wherever Fusion can do the work (D-40). Stage 3 started: [design direction](plans/B-390-design-direction.md); checkpoint 3a recorded (D-43–D-60); 3b recorded (D-61–D-66; goal surface rejected, B-413); 3c recorded (D-67–D-75; Amira's year's end rejected, B-414); 3d recorded (D-76–D-87; the goal surface accepted, B-413 closed); 3e recorded (D-88–D-95; Insights as Fusion's one dashboard, setting up a year as one page), B-412 closed: every screen has an accepted design. Slices: [slices](plans/B-390-slices.md), 1–13 in order.
          First priority after B-398: Core HR could demo tomorrow, Performance couldn't (user). Not from the ground up: what the module does stays; its functions are cleaned up, fixed and completed, its visuals rewritten the way Core HR's were.
          How, the Core HR rebuild's process again (B-164, files in `archive/plans/B-164-*`): map → target brief and scope page with depth ladders → design direction, then explorers checkpoint by checkpoint until every screen has an accepted design, recorded as decisions (D-43 onwards) → the rebuild in dependency-ordered slices, one session each.
          The user's verdict, at Organization direction right after launch: "I don't think we can save this … the front end for the Performance module is absolutely garbage." Notes for the redesign: the cycle page after launch (what it's for, what to do next); measures ask for a Direction that baseline and target already give; the AI coach works but may not stay as it is; the 1:1 page doesn't tell a manager what to do; an empty first agenda says nothing about why; calibration doesn't explain itself; Performance's Overview can't be trusted.
  - [ ] **B-405** The year on one page (hero H1, shines first): the Year page for everyone (next step, team, company for HR, the year replayed on its timeline), the phase from what happened and never backwards (D-34), HR moves the year on with a preview, nudges from the Year page, closing with unfinished goals carried into next year's drafts; HR insights move to Insights, Fusion's one dashboard (D-88, slice 13) · Performance · 2026-11-10
          Scope: Y2, Y3 at 3; Y4, Y5 at 2; S4 at 3; replaces Overview and the cycle page (D-33). Folds in B-392's phase and round-closing items. Unblocks B-395 (a year demoed in one sitting).
  - [ ] **B-406** Goals from the company down (hero H2): one Goals place (Company, units, You, Your team, the map as a view), company and unit goals at a glance, measures read back as sentences with direction from the numbers, the plan with even weights and its line up to the company's, approval from Home and Team with what changed, progress updated from the goal, the coach's quiet suggestions, goal grades from the measure (D-38) · Performance · 2026-11-10
          Scope: G1 at 3, G2–G7 at 2, N12 pulled back (D-38), weights per D-40.
  - [ ] **B-407** Conversations: 1:1s where the meeting is the page (agenda with each item's source, starter agenda, notes, actions), calendar invites and a feed (D-39), a monthly reminder to update goals, feedback from wherever a person appears with the request lifecycle, praise with starter values, reactions and the company wall (D-36), growth goals on the person page and in 1:1s and reviews · Performance · 2026-11-10
          Scope: D2, D3, D5 at 2; D1 at 1; D4 at 3; N7 pulled back. Calendar feed: `security-review` in its slice. Folds in B-392's praise and notification items (D-37).
  - [ ] **B-408** Reviews written from the year (hero H3): rounds launched and followed from the Year page, the form with the year beside it, the draft and reflection starter citing each sentence's source, grades prefilled, peers nominated without waiting and answering from Home, results read like a document and acknowledged in place · Performance · 2026-11-10
          Scope: V2 at 3; V1, V3, V5 at 2; D-18 change per D-40.
  - [ ] **B-409** Calibration by exception (hero H4, D-35): only flagged reviews to look at, each with why; keep in one click or adjust with a reason; finalize and release what's ready; nothing flagged goes straight to release; the full view with the nine-box and drag one click away · Performance · 2026-11-10
          Scope: V4 at 3. Folds in B-392's calibration items.
  - [ ] **B-410** Starter content and competencies by job (D-36, D-41): starter values, scale, competencies and questions offered when Performance starts; AI drafts values and competency expectations from jobs, families and units; expectations per job family and level used in reviews, with what the next level asks; settings previewed where they land · Performance · 2026-11-10
          Scope: Y6, D6 at 3; Y7 at 2. Builds on Core HR jobs' family and level (B-245 fills families from the import).
  - [ ] **B-411** Performance across Fusion: the Team page's Performance tab inside the frame (each person's year with the one action due, the team's goals under the manager's), the person page's tab as the one place (Performance's own person page goes), Needs you acting in place on Home, one notification per moment to act (D-37), results export from the round · Performance, Core HR, shell · 2026-11-10
          Scope: S1 at 3; S2, S3, S5 at 2; S6 at 1. Folds in B-392's "No one reports to you" (B-383).
  - [ ] **B-392** Performance: functions that are broken, missing or misused (not the visual rework, B-390) · Performance · 2026-11-09
          - Praise can never be sent in a new company: it must name a company value and a new company has none (`GET /api/performance/values` → []); the button stays grey with no reason. Unblocked in the walk by adding values in Performance › Settings › Competencies. Decided: values their own list with starter values (D-36).
          - Mariam was notified when Aicha added a development goal while still drafting, then again on submit. Decided: drafting steps notify nobody (D-37).
          - Calibration can't be finalized while any manager review in the round is outstanding (the round holds the whole roster, about 92, with only Aicha's in); the reason sits only in a hover tooltip on the grey button. Decided: calibration by exception, HR finalizes what's ready (D-35). Also: a rating kept as the manager gave it needs a "Discussed" tick before it saves, unexplained.
          - After results are released the cycle still reads "Review": the round stays open until closed separately (the phase is Review while any round is Active), and nothing says to close it.
          - After closing the round the cycle reads "Planning" again (decided: the phase follows what happened, never backwards, D-34): with no round open the phase comes from the dates only (before the planning deadline), whatever already happened (plans approved, results released).
          - Team's Performance tab tells Mariam "No one reports to you" though people do (B-383).
  - [ ] **B-389** Performance cycle setup (`/performance/cycle/setup`): built before the Core HR rework and liked ("not bad at all", "something I'm proud of"); polish, not a redesign · Performance · 2026-11-09
          Notes, Details: the section headers' little subtitles and icons (Cycle details, Timeline, At a glance) still read as AI-made.
          Notes: its date range calendar works as intended (unlike Reports', B-387: reuse it there); Next flickers and reloads the same step for a moment before moving to Population.
          Notes, Population: makes sense for the walk; photos missing here too (B-382); "All active employees" by default, 92 in and 8 needing attention.
          Bug: in the population table the Reviewer column's avatar is drawn differently from the Employee column's; style it the same.
          Notes, Review: after confirming the exclusions the admin still clicks Continue by hand to reach Review; Review recaps the setup and offers Launch.
          Notes, after launch: it lands on the cycle page (`/performance/cycle`), "abysmal"; what the page should be is open; not discussed now (B-390).
          2026-11-10, 3d: the setup surface itself now reads thin to the user (D-87): redrawn in 3e as one page with the year as its object (D-91), built in slice 12 with these bugs; launch lands on the Year (D-84).
          Notes: after launch nothing says what to do next; the administrator couldn't find where to set the company's direction (organization objectives) and typed `/performance/goals` by hand.
- [ ] **B-396** Stack 2 · Core HR after the walk · Core HR · 2026-11-09
          Functions apart from visuals (user, 2026-11-09). The surfaces follow B-397's foundation once it's decided in B-390's first chapter.
  - **Functions**
    - [ ] **B-245** The import groups titles into job families when the files have no family column (D-23 widened the AI to it): suggestions marked with the sparkle, each family changeable on the chart's Jobs view · Core HR · 2026-11-01
  - **Surfaces to rethink**
    - [ ] **B-352** The import (What Fusion understood, then Review, `/core/import/{id}`): functionally right, but reads as AI-made, unclear about what to do, not the friendly BambooHR-like direction; redesign both pages, canvas first (accepted in B-186 from a drawing, now rejected on taste) · Core HR · 2026-11-09
          Notes, What Fusion understood: loading shape (B-353); header: a light title, both file names shown sloppily, four competing actions, disabled "Show the changes", "Add files", plain-text "Start over", "1 question" (B-354); unclear whether a column chip like "Unit code" is matched or waiting, what each button does (B-355); the file icon + file name headings, tables stuck at 3 rows (B-356); the Grade question takes effort, the warning icon, "Fusion's lean" means nothing to a user or a demo audience (B-357, B-368); "3 people who have left" unexplained (B-358); "Show the changes" doesn't say where it leads, an org chart link made it look like the chart (B-359); "Across the files" looks straight out of ChatGPT (B-360).
          Notes, Review: a file name as the page title, file and "Matched by work email" badges, the yellow question count (B-362); scattered cards on the right, a whole card for the "Changes apply from" date, the checks' icons, the two-start-dates check about the signed-in admin reads awkwardly (B-363); the left column named after a file, "New 99", every row "Starts <date> · <name>'s team" whatever it means, past or future unclear (B-364); all 99 rows at once, a very long page; the "Changed 1" part works (B-365); "Bring in 100 changes" unclear (B-367).
          Notes, Bringing in and done: the progress and the counts work and are the good part; make them the wow (bigger bubbles that float with more life, numbers to match, more central); the line above the title with its check mark (date and files) is a poor choice; once done, "Next: invite your people" and "Worth a look" appear, the latter generic, with "left out for things you decided instead of the files" making no sense; the admin has nothing to do but watch and pick one of two buttons, so if the page exists to mark the finish, maximise its visuals.
          Direction agreed for the done page (user, 2026-11-09: "yeah, exactly", details later in the redesign's drawings): the counting bubbles settle into a live, compact org chart (top levels, fixed frame, full chart as a quiet link on it) as the proof; one action, Invite your people; the data gaps (no email, no place) move to the invite step where they matter.
          Bug to prove gone after the redesign (B-366): choosing "Add PGC as a new unit" reloads the card with that choice selected plus an unselected "PGC · Fusion's lean · closest".
    - [ ] **B-371** Organization (`/core/organization`: People chart, Structure chart, List, Plan): rethink it as one surface, built on the People chart, which the user prefers (its controls, filter chips, links) · Core HR · 2026-11-09
          Notes, both charts: the loading shape doesn't match; header and actions are fine, but Structure has Add unit, Import, Export, Manage unit types and People has none, though the import treats both alike; both headers the same, search on the left, a search as capable as the top bar's (fixed, no expanding animation); maybe move between Structure and People seamlessly; a subtle grid behind the chart; the chart fills the content area's height; an administrator, or anyone with nobody around or under them, starts on the whole company. Selecting a person in the chart (found with its search) should offer what can be done for them, e.g. invite them if they aren't yet; the user's first instinct when asked to invite Mariam.
          Notes, People chart: dragging a person under someone else works after a lag and opens Make a change; after saving, the old hierarchy shows for a second before the new one; picking a population with the filter chips should zoom and pan to it; dragging should show the card moving live, like Structure does.
          Notes, time for a manager: Mariam has Replay and the date on Structure but not on People; by design only HR moves time on the People chart (`canMoveTime` in `organization-place.tsx`), as people's past and future is HR's to see. Unexplained, it reads as a bug; (D) whether a manager may move time over what she already sees (her team), or the control says why it isn't there.
          Notes, Structure chart: opens compacted, showing only a few; decide how much to show without overwhelming (it does include the top levels, so maybe fine); its expand and collapse is jittery, reuse People's.
          Notes, List: follows the same header; enable drag and drop and the functions the charts have.
          Notes, Plan: the empty state is a wide empty block with a title and a two-word subtitle, embarrassing; a planned move's row carries the information but has lots of dead space on the right, and "Open one to see on the org chart" says in text what the design should show; redesign.
    - [ ] **B-374** People and invitations (`/core/people`, its Invite drawer): rethink the page and the drawer as a whole · Core HR · 2026-11-09
          Notes, People: after the import the admin wants to see the people just brought in, not a drawer opened over them; open on the cards view rather than the table; the table itself is good, the filters are good, but it doesn't show people's job titles at all; the Manager cell should open the manager's page (today the whole row opens the person); Add a person is mostly good; low priority: its team section could borrow the People chart's cards; the new person's manager got an email (and likely a notification) on save; the search should be the same capable search as the charts'; the tabs above the table have no business there, the filters can do their work, and then cards and table share one search and filter bar (one reusable piece in code too); when nothing matches (e.g. Starting soon) the awkward box with grey "Nobody is starting soon" is bad.
          Notes, Invite drawer: its header (the stock icon, default-font title) looks bad; Who (everyone, managers first, choose) is the right idea, the radio choice looks poor; Choose should be a real multi-select combobox using the people picker that shows more about each person, the selection obvious (today only a name and avatar in a fixed list); When is a wide row for a small two-option switch, the date picker filling the space only on Later; the next section's title makes no sense, and the section titles don't follow the type scale; "Invite joiners on their first day": invite them to what, isn't this the invite?; "Remind people after 3 days": what reminder, another email?; showing the email as it will look is a good choice, what's around it isn't.
          Notes, inviting one person: a person's page offers no way to invite them; the table's row menu does; on the cards the mail icon opens the mail app (fine for emailing someone day to day), and the invite action uses the same envelope icon: give inviting its own icon, about joining Fusion rather than sending an email, everywhere. Notes, after sending: the drawer closes and nothing shows the invitations taking effect; the admin has to page through or search for the people just invited;
    - [ ] **B-380** Roles (`/core/settings/roles` and a role's page): functionally very good, the design lacking; the list needs polish, a role's page a rethink of its layout · Core HR · 2026-11-09
          Notes, the list: good enough at first glance; the empty top-left cell should say what the rows and the columns are; a legend somewhere should explain what the cells mean.
          Notes, a role's page (Manager): the two columns aren't bad in themselves, the way they're used is; Who has it: a stranded "Anyone with a team" select, a stranded "+ Person" across a huge empty space, a rule line "1 of 1" that makes no sense, Show them / Hide them for no clear reason: right functions, confusing UI; What managers can do: good, the selects inside the sentences especially, but the whole right side of the card is empty.
          Notes, who holds what: the user concluded Amira, the administrator, had no administrator rights and that nobody did; she holds Administrators (the data says so), but the column reads "Protected" with a small face and "1 of at least 2", never her name. HR starts with nobody, not even the administrator, which surprised the user; an administrator already does everything HR does, so granting her HR changes nothing: the page should make both obvious.
          Notes, Administrators page: the Who section is good (Amira's card clean, the empty second-administrator card and its call to action clear); a whole History card is questionable; the page is two columns with the right one always empty, content over ~70% of the width, still empty after adding a second administrator (Mariam); the empty "add" card in a two-column grid leaves a dead cell.
          Notes, adding an administrator (and roles in general): only people who have accepted their invitation can be picked, so in a new company the choice is tiny (here only Aicha); (D) whether a role can be given to someone invited and take effect on acceptance. Adding an administrator doesn't deserve a whole drawer: a polished modal.
    - [ ] **B-384** Approvals (`/core/settings/approvals`): unclear what each switch does and who does what; "Place · waits for approval" only says it once on; "Who approves" is a stranded card at the bottom that doesn't say where the list comes from (whoever holds Approve changes for the whole company in Roles: today the two administrators, the same people for every kind of change); rethink the page · Core HR · 2026-11-09
    - [ ] **B-385** Changes and approvals (`/core/changes`): the flow works (the bell rang for Amira, its notification opened this page, Approve went through, the request moved to Answered); the page doesn't: empty Waiting looks empty, the Waiting/Answered tabs look bad (filters, as on People), the design reads vibe-coded; rethink it · Core HR · 2026-11-09
    - [ ] **B-386** Change history (Settings › Change history): the content is good, complete and tagged; the page is one of the ugliest in the product; redesign it · Core HR · 2026-11-09
    - [ ] **B-339** Brand (`/core/settings/brand`): rethink the page as a whole · Core HR · 2026-11-09
          Notes: the loading shape doesn't match the page (B-339); from the guide it opens inside Core HR with its sidebar suddenly full, unclear where you are (B-340); previews should show rich, plainly sample content rather than the company's empty state, previews in general (B-341, reverses B-249's stand-in decision); the logo upload should reuse the profile photo editor, crop and position (B-342).
  - **Surfaces to polish**
    - [ ] **B-377** Person page (`/core/profile`, `/core/people/{key}`): liked ("doesn't look bad", the hero "good, I like it", the photo editor "phenomenal"); polish, not a redesign · Core HR · 2026-11-09
          User 2026-11-09 (colour study): the right column split into separate cards is the old layout tweaked, "no bold design decision whatsoever"; the polish may need a bolder layout (note under D-32).
          Notes, Overview: section titles (About, Performance, Job and history, …) in the Fusion serif, their content not; what people write themselves (About, …) shown in quotes, in the serif; About's and Performance's empty states (B-376); "the whole story" → plain words (B-347).
          Notes, left rail: direct reports fine, "+X more" should load the rest; hire date, email and place facts plainer than they should be.
          Notes, Job tab: good; the Job section lays out three facts then one alone on the next row with dead space: rethink sizes and layout to fit; Employment and History fine. Personal and Performance pass with the general notes.
          Notes, photo: allow 8 to 10 MB, not 5; the pictureless avatar's ring is lost once a photo is set: keep a ring, accent to start, maybe (D) the base for a status (online/offline or wider); in dark mode the change-photo button is see-through, keep light mode's.
    - [ ] **B-372** Make a change panel (people, from a person's page or a chart drop): liked and reused in the right places ("looks clean", "works"); polish its weak spots, not a redesign · Core HR · 2026-11-09
          Notes, Describe it: drop the example placeholder and leave "Describe it"; say, without more words in the field, that AI drafts the change, and while it drafts say what it's doing (the spinner shows something is happening, not what); the sparkles beside the fields it filled are good.
          Notes, the drafter: it shouldn't depend on the user remembering exact job titles, places or employment types; read what they probably mean (the user has the last word anyway).
          Notes, the fields: the repeated edit icon beside each field is ugly, use another.
          Notes, Reports to: the user couldn't tell what it is: the current manager (Mariam) shows faded above an empty picker that only means "a new manager", so it reads as unselected; "Leave without a manager" on its own row belongs at the right of the Reports to title; 
          Notes, a manager proposing (Mariam): the panel saved without asking for Reports to and scheduled the move straight away, saying nothing about approval. That is the company's setting: every approval type starts off (Settings › Approvals: job, manager, place, leave, leaving, home address all not required), so a new company's managers change their people directly. (D) whether a new company should start with approvals on for managers; either way the panel should say whether the change waits for someone or applies.
          Notes, with approval on: the "Amira or another approves" section and its note "Your company approves place changes" look good; keep it compact when several kinds of change wait. A second change on the same date is refused only after pressing send ("Aicha Bouazizi already has a change on 1 December. A new change has to come after it."): say it when the date is picked, and offer to open the existing change.
          Notes, Set leave: the date chips are unexplained shortcuts (From: next Monday or the Monday after; Until: the Friday that ends one or two weeks, or Not known yet); the user couldn't tell what they were for; say it through the design (e.g. "1 week", "2 weeks"). From and Until as two sections with two pickers say one thing: use one date range picker (shadcn-based, e.g. ReUI's). The "Also changes" block is a wall of text nobody reads (where it shows, that Performance carries on): say only what must be said, or nothing.
          Notes, End employment (lower priority): for a manager with three people, the panel shows one "Reports go to" select and then the same select again per person; picking the top one doesn't change the others, so it's unclear whether it's a shortcut for all; the Last day section and the "Add a note" text link look poor.
          Notes, a coming change on the person page: the "coming up" card looks good, but shows only part of the change; its Edit and Cancel buttons need rethinking; clicking the change should take you to its date (instead of ⋯ › See it on another date by hand). The row in People said "moves 9 November", nice; Aicha's open tab chimed with a notification.
          Notes, editing: the edit panel differs slightly from the create one; it should be the same, Describe it and AI included.
    - [ ] **B-383** Team (`/core/team`, a manager's page): the top is liked, the rest degrades; polish (and see B-378, which may merge it into Home) · Core HR · 2026-11-09
          Notes, liked: the hero (clear title, clean cards, the call to action); keep and polish it: Give praise in the brand's colour, hover effects on the team members. The team org chart "looks fantastic"; it takes the main chart's fixes (B-371).
          Notes, to fix: tabs here and on the person page should carry an icon each; below the hero it degrades: Coming up looks cut off with so few items, the left rail is basic and boring next to the hero.
          Bug: in the hero, some text overflows out of the team member cards (seen with Aicha's leave set).
          Bug: the Performance tab shows an empty card "No one reports to you" with "Go to overview" for Mariam, who has reports (no cycle has started; the message is wrong either way).
    - [ ] **B-387** Reports (`/core/reports`, a report's page) · Core HR · 2026-11-09
          Notes: after changing dates there's no clear way back to the ready-made report's own dates and filters (the user re-clicked Headcount, then refreshed); "Share" means letting a role see the report, not a link, and doesn't say so: make it clear and useful, or drop it; Save, the main action, belongs on the right.
    - [ ] **B-388** Core HR's front page (`/core`, Growth, People, the next 30 days) · Core HR · 2026-11-09
          Notes: hovering over the Growth chart moves the whole page's date, which surprised the user ("is this intended?"); scrubbing should be deliberate (drag, or a clear preview that snaps back).
          Notes: the page looks fine overall; the next 30 days runs a little empty with dead space on the right; the bottom cards (Records to complete, Open roles) are scattered with bad empty states: the same cards, empty space and empty states problem again (B-376).
- [ ] **B-397** Stack 3 · Fusion-wide · Shell, `@repo/ds`, all our apps · 2026-11-09
          Decisions and rules are settled first, on their own page, per situation: [page](https://claude.ai/artifact/Kq91ddwjiTPb4BrEEVzCLF), [plan](plans/B-397-foundation.md), waiting on the user; applying them to Core HR comes with B-396; Home after Performance, since it surfaces what matters from both.
  - **Foundation**
    - [ ] **B-370** Surface colours in both themes, product-wide: light mode first, then dark · `@repo/ds`, all our apps · 2026-11-09
          Decided 2026-11-09: D-32 in `design/decisions.md` (dark graphite; light, the hero and the page one soft tone, cards a step up). Left: apply it in `tokens.css` and check every surface in both themes.
          Notes: light mode is all over the place; the page background is too grey (a dark white); the person page hero's light background would suit the app's body, with slightly different tones for sections. On the import's done page the main section's tone is right and the sections below lift lighter in dark mode (the opposite in light). Unify across the apps, then do the same for dark.
    - [ ] **B-418** Nothing brown in light mode, sections' edges lined up (D-95): the amber that suits dark (chart bars, highlights, accents) gets a light-mode value that stays a clear yellow-gold; every page's sections share edges with no gaps or misalignment, by arranging content, never filler · `@repo/ds`, all our apps · 2026-11-10
          The user, at 3e (the Insights charts in light mode): "I don't like that the right bar graphs and some stuff is colored brown … no empty spaces or misalignment in the edges of sections". The colour goes in with B-370 (STATE row 3); the edges rule is held in every Performance slice and in B-396's Core HR pass.
    - [ ] **B-376** Empty states across the product are mostly bad: grey words in a box ("No cycle", "No review", "Nobody is starting soon", the Organization Plan); give them real design · all our apps · 2026-11-09
    - [ ] **B-379** Loading shapes across the product: almost every surface shows a loading shape that doesn't match it, at least on first load (Home, Brand, the import, Organization, Roles, …); one pass over all of them · all our apps · 2026-11-09
    - [ ] **B-347** No AI tells: no em dashes anywhere (browser tab titles first), no "100 people · 42 units" style stat lines strung with dots (show the information another way, if it's needed at all), no fluffy wording ("the whole story" for a link to the Job tab: say it straight), and a sweep for the other tells · all our apps · 2026-11-09
    - [ ] **B-373** One way to show an entity's details: today a person, a unit and others each open in a different kind of panel; move them all to the Make a change panel's template, the one the user likes · Core HR, Shell · 2026-11-09
    - [ ] **B-382** A person's photo wherever they appear: Mariam's photo shows on her page but not on the Administrators card (initials there); about 40 of 45 avatar uses in Core HR, Shell and Performance pass no photo, and some lists (role faces) don't send one from the server · Identity, Core HR, Performance, Shell · 2026-11-09
    - [ ] **B-394** Optimistic updates across the product: what the user just did shows at once and rolls back only if the server refuses (seen: the org chart showing the old hierarchy for a second after a move, invitations not visibly taking effect, flicker after Next in cycle setup) · all our apps, `@repo/api` · 2026-11-09
    - [ ] **B-375** Facet filter buttons (the filters used across the rebuild, liked): on hover the background's radius doesn't match the border's · `@repo/ds` · 2026-11-09
  - **Decisions**
    - [ ] **B-381** (D) One navigation system for the whole platform: some pages have a back button (a role's page: back to Roles), some don't, and the top bar has breadcrumbs; decide once how breadcrumbs, back links and the rest work together · Shell, all our apps · 2026-11-09
          User idea: one sidebar for everything, every module and its pages and the settings, so the product shows how much it holds and nobody hops between modules to do one thing. Moving between Settings and the modules today flickers through loading states.
    - [ ] **B-393** (D) One icon set: the user loves the Hugeicons glyphs Performance uses (praise reactions: clapping, party, lightbulb, heart); Core HR, the shell and `@repo/ds` still use Lucide. Consider moving everything to Hugeicons through the same adapters · all our apps, `@repo/ds` · 2026-11-09
    - [ ] **B-338** (D) Top bar: the user's avatar with a menu (contents to agree), checking how the bar's items sit in all its states · Shell · 2026-11-09
          Today sign-out lives in the user's menu at the bottom of the sidebar, which the user doesn't call bad; the top bar avatar is an addition, so decide how the two menus relate.
  - **Shell surfaces**
    - [ ] **B-333** The invitation page (`/activate-invitation`): rethink the page as a whole · Shell · 2026-11-09
          Notes: the "Do you work here?" choice wants to be simpler, friendlier, more compact (B-333); answering yes adds the job title field and the left column jumps with it, the columns must be independent (B-334); the left column's logo and name block is weak, its background empty and boring (a photo or a better pattern), the plain "Fusion" mark (B-335, see B-332); black fields on black, fills changing inconsistently, the page taller than the screen (B-336). The employee's variant (Mariam's) fits the screen without scrolling: keep every variant within it.
    - [ ] **B-378** (D) Home, for everyone: a foundational problem, not a page polish. The administrator's Home (B-337 is its day-one evidence) has the same structure, stranded cards and empty space; a manager's or an employee's (Mariam's in her first week) is worse: unacceptable as it is, empty and boring ("Needs you" empty, plain cards everywhere), and even filled it would be generic. Rethink from first principles: why someone comes here, where they come from, what belongs here and whether that information is worth having, then decide on a new design or folding it into another page. Supersedes the cards accepted in B-247/B-248 · Shell · 2026-11-09
          User idea, at Mariam's Team page: merge a manager's Team into Home; Team "at a glance looks better" and Home would take what it must carry; not everything on Home has to be on Team. Weigh it in the rethink.
          Day one (was B-337): the loading shape doesn't match the page (B-337); the guide shows "Your company" done before the admin touched it (B-344); its edit links need care (B-345); nothing leads back to the setup after a step, the admin falls back on the browser's Back (B-343, maybe part of the product tour B-090); seen again from Organization: once inside a module the admin is cut off from the setup and found no way to invite people but the browser's Back; the big drop column beside a small near-square company card with dead space looks sloppy together (B-346); nothing says what the files need, and the one template (`Fusion-import-template.xlsx`, today only on Core HR's import page) isn't offered here: agreed to offer it quietly beside "any layout" (B-348); the by-hand way looks weak, "add the first unit" undersells building the whole company by hand, and it opens the same Organization page the import ends on (B-349); the "Reading 2 spreadsheets" state is poor (B-351).

### Demo preparation

Prep for the demo, not active work.

- [ ] **B-395** A live demo of a cycle that takes months in real life: the phase follows the dates, so a cycle run in one sitting goes Planning → Review → back to Planning. Likely: live parts on a company whose dates put today in the right phase, plus a company prepared through the product (and a Development-only seeder where the API can't reach past dates, asked first) already at reviews and calibration · demo data, Performance · 2026-11-09
      User, 2026-11-09: agreed for the demo (live on a fresh company, cut over to a prepared one for reviews and calibration); not as the long-term answer.
      2026-11-10: D-34 settles the long-term answer (the phase follows what happened, never backwards; HR moves the year on with a preview), built in B-405; revisit this item once it is.

### Big features

Each is a project of its own: a decision page first, then sessions.

- [ ] **B-090** Product tour: an interactive walkthrough that takes a new tenant from the platform admin's invite through its first real use of Fusion · Shell, Core, Performance · 2026-10-20
      User: another wow factor that, done right, also carries a realistic demo from the tenant's point of view, "taking over after the initial platform admin invite". Open: where it starts and ends, who it's for (tenant admin, HR, manager, employee), guided steps vs. checklist vs. contextual hints, and whether it runs on real or demo data. Best after B-089 and the demo seeder, so it walks finished screens.
      User again 2026-10-29: onboard the person in real time, a tutorial that shows them around and guides them to set up their things; would carry the demo too. No details yet, discussion first.
      User 2026-10-30: "i would want a product tour, its a good prio feature". Next up; starts with a decision page (where it starts and ends, who it guides, how it moves through real screens) before any code.
      User 2026-10-30, later: the tour needs cleanly engineered features first, so it follows B-164; its storyline is B-166's journey, and the explorer marks the tour-worthy moments.
      User 2026-10-30, checkpoint 2: consolidate with B-164's setup guide (F1). One guidance system: the setup guide on Home is the tour's administrator track; each step opens the real screen where the tour takes over. B-167 builds the guide for the tour to extend.
- [ ] **B-105** Real internationalization: English, French and Arabic fully configured across our modules (Arabic means right-to-left layouts too); screens are done in all three, only server text (B-116) is left and parked · Shell, Core HR, Performance, Platform · 2026-10-23
      From B-071 C-6: the switch lives in Settings > Preferences. 2026-10-24, user: wants EN/FR/AR later, so "remove the switch" is off the table. To discuss: how translations are stored and loaded, dates and numbers per locale, RTL in `@repo/ds`, server text (emails, notifications, errors); a company's default language is set in Settings › Brand (B-176).
      2026-10-24: agreed to settle the foundation first (translation library and message format; start/end instead of left/right in `@repo/ds` and our apps, lint-guarded) because every new screen adds cost. Decision page delivered: [artifact](https://claude.ai/artifact/R1x8YyFNNTf4qsHVBph1U9) (`plans/B-105-internationalization.html`). User 2026-10-24: language lives on the account (I-3); colleagues' modules only must not crash; we draft translations, no native reviewer; the rest as recommended. Phase 1 proposed as OpenSpec `add-i18n-foundation` (strict-valid, 11 tasks): account language in Identity + `NEXT_LOCALE` from `@repo/auth`, next-intl wired in our four apps via `@repo/i18n` with Preferences translated EN/FR as proof, start/end layout + lint guard, one place for dates and numbers. Preconditions met 2026-10-25 (polish pass and Settings committed, Settings change archived): ready to apply in a fresh session.
      2026-10-25: phase 1 (the groundwork) accepted (user moved on: "Just proceed"), archived as `2026-10-25-add-i18n-foundation`, uncommitted for the user to commit. Phases 2–5 are the children below, in the decision page's order.
      2026-10-25: phase 2 (B-113, the frame in English and French) accepted (user: "proceed"), uncommitted for the user.
      2026-10-26, user: get internationalization done fast and move on. The demo shows a few screens at most; the goal is the feature working in French and Arabic, not perfection. Remaining children run lean: translate what renders, no per-area screens or polish, one French/Arabic test per module.
      For the Arabic phase: the CSS build maps logical insets to left/right through `:lang(ar …)`, so `<html lang>` must be set with `dir`; sheet sides, slide animations and time-axis charts are still physical.
  - [ ] **B-116** Phase 5: server text in the person's language: emails per recipient, notification and error codes rendered on screen, change history as data · Identity, Core HR, Performance · 2026-10-25
        From B-114 D8: AI output (plan coach, review starters, calibration summaries) answers in the person's language.
        2026-10-26, user: skip for now ("skin b116 for now"); French and Arabic screens are done (B-114, B-115 closed). Not next.
      User 2026-10-30: B-116 is low priority for now.
### Before hosting

Security and scale that must hold once Fusion is online; nothing changes in the demo.

- [ ] **B-296** Prove a single sign-on domain by DNS before Fusion is hosted: today the first company to pass a test sign-in from a domain proves it, so a company running its own provider could claim another company's unclaimed domain and show its button on that domain's sign-in page · Identity, Core HR · 2026-11-05
      Found in the B-191 security review (accepted rung 2 in the plan, D9). A claim never signs anyone in across companies; the risk is the sign-in page steering another company's people to that provider. Fix: a DNS TXT record per domain, checked before it counts as proved.
- [ ] **B-310** Before hosting: the Gateway and Identity trust a forwarded client address only from loopback, so once the shell, Gateway and Identity run on separate machines each needs its hop's address in `KnownProxies`, and a shell behind a load balancer needs the stamp to take the balancer's address instead of the socket · Shell, Gateway, Identity · 2026-11-07
- [ ] **B-255** Scale Reports filter values with viewer-scoped server search when company data grows; report runs currently return the complete allowed value set.

### Cleanup and tooling

- [ ] **B-404** The memory index (`memory/MEMORY.md`) is ~21 KB, near its 24 KB read limit: compact it under ~17 KB (one short line per entry, merge or drop stale ones) · tooling · 2026-11-09

### Parked

- [ ] **B-230** Parked by the user, 2026-11-06; don't offer it again unprompted. Demo photos for Carthage's people (slice 6's row); every page draws initials today · Core HR · 2026-10-31

## Needs discussion

### Big features

- [ ] **B-147** Fusion assistant: one AI assistant across the app that answers questions from the tenant's own data (people, org, goals, reviews, conversations) through retrieval over our modules, within what the asker may see; another wow feature for the demo. Decide scope, which modules it reads first, and how it respects permissions (retrieval runs as the asker, never a wider index) · Shell, Core HR, Performance · 2026-10-28
      User 2026-10-31: the change drafter (B-179) could use it too, as a wow factor rather than a need; today it sends the company's whole lists, which fits.
      User 2026-11-09 (B-331 walk, after Describe it in Make a change): the assistant should act, not only answer: describe what you want in words and it does it, like Describe it drafts a change today, with the person confirming. Details later.
      User 2026-10-30: depends on whether our modules are complete (B-163, part of B-164, checks that).
      2026-10-30, B-164 scope: questions about people in plain words (D2 rung 3, reports) land here; "describe a change" (I2) is built in B-167 and can share its AI plumbing.
- [ ] **B-332** Fusion's own brand: agree on a logo and the rest of Fusion's identity (wordmark, colours, type, voice), then carry it everywhere Fusion speaks as itself: the email template, sign-in and invitation pages, the platform area, the landing page (B-111) · Shell, Identity, `@repo/ds` · 2026-11-09
- [ ] **B-111** A proper landing page for Fusion: the public front door before sign-in · Shell · 2026-10-24
      User idea, first paired with B-110 (closed 2026-11-08, branding built): the tenant-branded sign-in and the public landing page are two faces of one front door. Today visitors who aren't signed in go straight to `/auth/signin`.
      2026-10-30, B-164 scope: branding stops short of the company's own web address; that address belongs here, with hosting.
- [ ] **B-169** Core HR after the rebuild: the rungs chosen at checkpoint 2 to keep for later, so they aren't lost · Core HR, Shell · 2026-10-30
      From B-164's scope page (brief §6b). Each is the next rung above what B-167 builds.
  - [ ] **B-170** Companies arrange the person page's sections from their own fields (P1 rung 3) · Core HR · 2026-10-30
        User: "Showcase is a nice to have, record it for now".
  - [ ] **B-171** AI data health: likely duplicates, odd job titles, managers with too many reports, with proposed fixes (P4 rung 3) · Core HR · 2026-10-30
        User: "Keep ai for later nice to have potentially".
  - [ ] **B-172** A weekly people digest by email: joiners, leavers, changes, celebrations (D1 rung 3) · Core HR, Shell · 2026-10-30
        User: "Record Weekly digest for later".
  - [ ] **B-174** E-signature: HR sends documents to sign; people sign in Fusion; the signed copy and signing record stay on the person (pulled back at checkpoint 2, then parked) · Core HR · 2026-10-30
        User: "e-signature can stay on nice to haves for now recorded". Shape if built: brief §6b (E1), on top of documents on a person.

### Before hosting

- [ ] **B-053** Complete the production evidence storage gate · Performance · 2026-10-08
      The tenant retention setting and app-side expiry are implemented under B-056. Production use remains gated until a private shared object store is selected, backup/restore is tested, and malware scanning is in place. Provider selection is still undecided. See [plan](plans/B-053-performance-evidence-storage.md).
