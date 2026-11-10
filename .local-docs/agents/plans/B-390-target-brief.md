# B-390 — What Fusion's Performance should be (target brief)

Stage 2 of [B-390](B-390-performance-redesign.md), 2026-11-10, written the way Core HR's was (`archive/plans/B-164-target-brief.md`). It sets the target from first principles and a study of established products; the [map](B-390-map.md) records what exists. The user picks scope on the **scope page** (`B-390-scope-2.html`), which carries every feature with its depth ladder; this brief holds the reasoning and doubles as material for the graduation report (existing solutions → what Fusion takes, improves or adds). The first scope page's chapter 2 (`B-390-scope.html`) was mined, not kept.

Authority stays as in the plan: the user's answers, then `archive/plans/B-068-decisions.md` (Performance's domain decisions D-01–D-41) where not changed, then `design/decisions.md` and `DESIGN.md`. Nothing here overrules B-068 by itself; where the scope page proposes a change to a B-068 decision, it says so.

## 1. Performance in one sentence

**The company agrees what each person should achieve this year, keeps it moving through regular conversations, and judges it fairly at the end, so everyone knows what's expected of them, how they're doing and how to grow.**

Eight jobs follow. Every feature serves one; a feature that serves none is cut.

| # | Job | Today in Fusion (from the map) |
| --- | --- | --- |
| J1 | **Set the direction**: company and unit objectives, their owners | Built and sound (cascade, owners, Draft → Published); unreachable (not in the sidebar, typed by hand); its page "can't be saved" |
| J2 | **Agree what each person delivers**: a plan per person, approved by the manager | Works end to end (draft, submit, approve or return with requests, exceptional approval); cards just restored |
| J3 | **Keep the work moving**: progress, status, evidence, asking for updates | Works (updates with status and evidence, weighted roll-up to calculated parents, update requests) |
| J4 | **Talk through the year**: 1:1s, feedback, praise | Works; the 1:1 page doesn't say what to do; praise is blocked in a new company |
| J5 | **Review fairly**: self, manager, peers, calibration, release | Works to release; calibration unexplained; the round stays open after release |
| J6 | **Help people grow**: development goals, competencies | 1–5 growth goals inside the plan; competencies are one flat list |
| J7 | **Run the year**: open it, move it through its phases, close it | Setup liked; the page after launch "abysmal"; phase reads wrong after release and after the round closes |
| J8 | **See how it's going**: who's behind, where the risks are, how ratings spread | Overview not trusted; insights on the cycle page's second tab |

The map's reading: the domain is mostly right, the module fails at **J7 and J8's surfaces and at "what do I do next" everywhere**. The walk broke down exactly at the hand-offs (launch → direction, 1:1 → what to talk about, reviews in → calibration → close).

## 2. Who it serves

Capabilities composed on the server, never personas (D-R1): one person can be an employee, a manager, a unit owner and HR at once (Amira Khelifi, the administrator, is all four in Carthage).

- **Employee** (everyone in the year): writes and puts forward their plan, updates progress, has 1:1s, gives and asks for feedback, writes a self-review, reads and acknowledges results, works on their growth.
- **Manager** (has direct reports in Core HR): approves plans, follows the team's progress, runs 1:1s, writes manager reviews, proposes ratings.
- **Unit owner / leader** (owns a unit's objectives): sets and publishes the unit's direction, sees how plans support it. Reads insights only with the HR permission (D-R2).
- **HR, the year's administrator**: opens the year, keeps it moving (reminders, who's behind), runs the review round and calibration, releases results, closes the year; sets the company's direction with leadership.
- **Peer**: answers a few questions about a colleague, sees only their own questions (D-R4).
- **Calibration facilitator**: runs the calibration session (usually HR).

## 3. Study of existing solutions

What each product is known for in performance, from vendor pages and docs (vendor claims marked as such; roadmap items marked "announced"). Fusion's column is what it takes and where it goes further.

| Product | Known for | Fusion takes | Fusion does differently |
| --- | --- | --- | --- |
| **Lattice** (mid-market leader) | Review cycles (annual, quarterly, project), goals linked to company objectives, 1:1s and weekly updates ("Habits"), calibration with conflict-of-interest groups; 2026: **evidence-based AI reviews** drafted from 1:1s, past reviews, feedback and goals, "see sources", managers keep ratings and submission; an AI agent that joins 1:1s for notes and actions (announced); calibration analytics before and after (announced) | Evidence-backed drafts with sources, ratings always human; goals tied to the company's | The source shown on every sentence and the evidence beside the form even without AI; one product with the HR record from the start, not an HRIS added later (Lattice HRIS, 2023) |
| **Culture Amp** (people science) | Reviews with self-reflection, peer and upward feedback, calibration, anytime feedback, shoutouts; 2026 Q3: **cascading goals with automatic roll-up and weighted supporting goals**, AI Coach inside self-reflections, peer feedback and development plans, **probation reviews auto-enrolled for new hires**, feedback requests that can be declined, withdrawn or expire | Roll-up (Fusion already has it, weighted), coaching in the moment of writing, the feedback-request lifecycle, the probation idea | Probation from Core HR's real start dates without a second system; the coach suggests, the person applies |
| **Leapsome** (all-in-one talent) | Modules: reviews (360, self, peer, project-based), goals and OKRs with goal trees, meetings with templates and AI summaries, **competency frameworks (AI can generate one)** linked to reviews and goals, learning; now HRIS and recruiting | Competencies as a framework, not a flat list; starter content for a new company | Starter sets offered when the company starts Performance, then theirs to edit; no separate module per feature |
| **15Five** (manager effectiveness) | **Weekly check-ins** (pulse, wins, challenges), High Fives (praise), Best-Self Review; **Kona**: AI draft review from all 1:1 notes, check-ins, High Fives and goals of the period; Kona Coach, a manager coach on live data, tips private to the manager; meeting assistant | A light check-in rhythm; the manager's coaching kept private; the review drafted from what was recorded | No chat-app coach: help appears on the page where the manager acts (the 1:1, the review) |
| **Betterworks** (OKRs, enterprise) | Goals and OKRs with cascading and alignment views; conversations with AI assist; calibration with 9-box filtering, talent pools and succession; AI bias detection (vendor claim) | Alignment shown as a view people use; computed flags in calibration | Flags computed and explained (lenient managers, rating vs outcome, big moves), never an AI verdict on people (B-068 D-25) |
| **HiBob** (mid-market HRIS) | Review cycles with templates, smart nudges and reminders, "manager performance companion" for evidence-based reviews, development plans companion; **calibration events standalone or integrated, drag-and-drop 9-box, a calibration agent**; changes held in the calibration worksheet until the event closes (third-party guide) | Nudges from the cycle; calibrated changes held until finalized (Fusion's original ratings already stay fixed, P5) | Calibration that says what each step is for, for a company without a people-science team |
| **BambooHR** (SMB, friendliness bar) | Simple assessments (self and manager) with notifications, goals with sub-goals rolling up, feedback requests, 1:1s with agendas, past meetings and private notes | The friendliness and the small number of concepts; private notes in 1:1s (built) | A full year (direction to calibration) without losing that simplicity |
| **Workday** (enterprise) | Business processes; reviews launched **with calibration** pull the overall rating and potential into a calibration event and write the calibrated rating back into the manager's evaluation; nBox (9-box) reports; check-ins; goals cascading | Calibration as part of the review's lifecycle, rating and potential together (D-24) | None of the configuration weight: one guided path |

**Where the market is in late 2026:** AI drafting from the year's record is now table stakes at the top (Lattice, 15Five, HiBob all claim it); cascading goals with roll-up just reached Culture Amp; calibration tools are still "a grid and a spreadsheet for experts" (analytics announced, not shipped, at Lattice). Nobody shows a **year** as one living thing everyone shares: cycles are admin progress tables, and each person's tasks live in a separate inbox.

**What nobody does well, and Fusion can:**
1. **The year as one page for everyone**, at the depth each role allows, with a phase that follows what happened (not only the calendar) and the next step always in front.
2. **One record with Core HR**: the population, managers, jobs, start dates and leave come from Core HR as dated facts; the person page and the team page are the same in both modules; Performance answers in Core HR's Reports.
3. **Reviews written from the year**: the evidence beside the form, the draft citing its source sentence by sentence, never a rating.
4. **Calibration a mid-size company can run**: guided, explained, partially finalizable, with computed flags.
5. **English, French and Arabic, right to left**, for the region.

## 4. Principles

B-068's principles stand (P1 one year one story, P2 capture once reuse at review, P3 people see work not modules, P4 the human decides, P5 history is fixed, P6 visibility follows relationships, P8 complete not staged). The walk adds:

1. **Every page says what's next for you.** The walk failed at every hand-off. A page leads with the viewer's next step in this year, or with nothing to do; never with a wall of status.
2. **The year moves with what happened.** The phase reads from events and dates together; a released round, a closed round, all plans approved all show. It never goes backwards.
3. **One person, one team, one Home.** Performance adds to Core HR's person page, Team page and Home; it doesn't keep its own copies (Core HR principle 1, D-12, D-19).
4. **Found from where you are.** Every place is reachable from the sidebar or from the page that leads to it; nothing is reached by typing an address.
5. **Validation prevents, it doesn't explain** (B-397's U6). A new company can send praise because starter values exist or a value is optional; a finalize that can't run yet offers what can run.
6. **Speak people.** No "cycle population snapshot", "scope owner", "contribution link", "exceptional approval" on screen. One glossary with Core HR.
7. **Core HR's design language, bold where redesigned.** Records and workspaces follow the rebuilt Core HR (D-01–D-31, D-32 colours); surfaces called garbage get structural redesigns from their job, not restyles (`redesigns-bold-not-tweaks`). Cycle setup is liked: polish only.
8. **AI where it removes work, always cited, always applied by a person** (B-068 P4).

## 5. Information architecture, from first principles

**Who opens Performance and for what:**

| Who | Opens it to | Today goes to |
| --- | --- | --- |
| Employee | see what's expected of them, update it, prepare a 1:1, write the self-review, read the result | Overview, My Plan, 1:1s, Feedback, Reviews |
| Manager | approve plans, see who's behind, run 1:1s, write reviews | Core HR Team › Performance (full reload), 1:1s, Reviews |
| Unit owner | set and follow their unit's direction | `/goals`, not in the sidebar |
| HR | open, move and close the year; run reviews and calibration; see how it's going | Cycle, Reviews › rounds, calibration, Settings |

**The proposal (drawn as a choice on the scope page, Q2):**
- **Year** (front page, everyone): where the year stands, its phase and dates; your next step; your team's (managers); the company's (HR: completion by unit, who's behind, insights, reminders, release, close). Replaces both Overview and the cycle page. Setup opens from here ("Start the 2027 year").
- **Goals**: one place for objectives at every level, by scope: the company, units, you, your team. Your plan is "You" (draft, submit, approval in place); the company's direction is "Company" with its map. Replaces My Plan and Organization direction; fixes "Direction not found" by construction.
- **1:1s**, **Feedback** (praise inside), **Reviews** (yours to write and read; HR's rounds and calibration inside): as today, redrawn.
- **Outside Performance**: the manager's team on Core HR's Team page (D-19, its Performance tab inside the same app frame, no full reload); a person's year on Core HR's person page (Performance's own `/people/{id}` goes); Needs you and Your year on Home (D-12, rethought in B-378); Performance's settings inside Fusion Settings.

Five sidebar entries, one fewer than today, and no hidden place.

## 6. The target journey

**Opening the year (HR).** From the Year page, "Start the 2027 year" opens the setup they like (details, who takes part, review, launch). If the company has no values, scale, competencies or questions yet, starter sets are offered on the way and kept or edited later. Launch lands on the Year page in Planning: 0 of 92 plans in, and one next step for HR, "Set the company's direction", that opens Goals › Company.

**Planning (everyone).** Amira writes two company objectives with the coach's help and publishes them; unit owners add theirs under them. Aicha Bouazizi, an employee, opens Year: her next step is her plan; in Goals › You she writes three objectives, the coach suggests a measure and the company objective each supports; she submits. Mariam Gharbi, her manager, approves from Home's Needs you or the Team page in one click, or returns one objective with a request. The phase moves to Execution when the planning deadline passes or every plan is approved.

**During the year.** People update progress from the objective itself; a manager's update request opens exactly there. Every 1:1 opens on the next meeting: a short agenda built from what moved (an objective at risk, a feedback request, an open action), each item saying where it came from; a first meeting starts from a starter agenda. Feedback and praise are given from wherever a person appears; praise shows on Home and the person page.

**Reviews.** HR launches the round from the Year page; the phase moves to Review. Mariam opens Aicha's review: the form with the year beside it (final status of each objective, evidence, feedback, praise, 1:1 notes), and a draft whose every sentence opens its source; she edits, rates, submits. Peers answer from Home.

**Calibration and release.** Amira opens calibration: who's ready and who's still writing, the spread against the scale, the nine-box, flags worth a look (one manager 0.9 above the average); she adjusts with a reason and finalizes what's ready. Release closes the round; the phase reads "Results out". Aicha reads her review like a document and acknowledges it. Closing the year carries unfinished objectives and growth goals into next year's drafts.

**Seeing it (HR and leaders).** The Year page's company part shows completion by unit and manager, status mix, rating spread; every figure opens the people behind it. Core HR's Reports can include Performance fields for viewers allowed to see them.

## 7. Proposed scope

The scope page has every feature with its ladder (0 not built · 1 works, minimal · 2 what established products do · 3 showcase), effort and the agent's pick. In short:

**Heroes (rung 3):**
1. **The year on one page** (Year page, phase from what happened, HR moves the year on deliberately): the module's missing spine and the walk's biggest failure.
2. **Goals from the company down** (one Goals place, the map as a view, the coach suggesting the parent): direction found, seen and used.
3. **Reviews written from the year** (evidence beside the form, cited draft): parity with Lattice's 2026 release, ahead on citation and on working without AI.
4. **Calibration that explains itself** (guided session, partial finalize, nine-box and computed flags).

**Clean at rung 2:** cycle setup polish, reminders and nudges, closing and carrying over, starter content, settings with previews, measures, the plan, approval, progress, 1:1s, meeting prep, feedback, praise, development, rounds, peer input, results, the team's performance, the person page, notifications, Home.

**At rung 1:** a check-in rhythm, competencies per job, Performance in Reports.

**At 0, offered:** probation reviews from Core HR start dates.

**Not doing** (visible on the page, any of it can be pulled back): compensation reviews, engagement surveys, succession and talent pools, improvement plans (PIPs), upward feedback, reopening released reviews, calendar sync, Slack and Teams, an AI that joins or records meetings, progress read from other tools, asking about performance in words (the assistant, B-147), OKR grading, live co-editing of plans, a skills marketplace, links to Learning.

## 7b. Scope as settled at checkpoint 2 (2026-11-10)

The user's answers on the [scope page](https://claude.ai/artifact/VMaufYFnS2JUbPbd4xnbxm) (db doc `scope/main` v59), with the agent's resolution where the user asked for a call. This section wins over §7 where they differ. The decisions it confirms are D-33–D-42 in `design/decisions.md`.

**The user's word over everything** (2026-11-10): "I really really value non-friction, because this type of module depends on too much … we need to weed out what we can while keeping it a Performance module, but also remove the friction as much as we can." Hence principle 9 below and D-40's list.

**Questions:** Q1–Q4 as recommended: HR finalizes what's ready; five places (Year · Goals · 1:1s · Feedback · Reviews); drafting steps don't notify; the year is called by its name ("2026"). Q5 "whichever makes sense for the context": **the Year page (H1) shines first**, because it's the spine every other surface hands off to and the walk's worst failure (launch landed nowhere).

**Raised by the user to rung 3:**
- **D4 Praise:** plus a company wall, the week's praise and the values most given (lives in Feedback; its place decided in the explorer).
- **D6 Competencies by job:** expectations per job family and level, read from Core HR's jobs (each job has a family and a level), used in reviews, and a person sees what the next level asks. From rung 1: this is the biggest scope change.
- **S1 The team's Performance:** inside the Team page, each person's year with the one action due, plus the team's goals under the manager's.
- **S4 HR insights:** on the Year page, each figure opening the people behind it, plus this year against last (history from D-40's Development seeder, B-068).
- **Y6 Starter content:** starter sets offered when Performance starts, plus AI drafting values and competency expectations from the company's jobs, families and units; each suggestion applied by a person (P4).

**Pulled back from "Not doing":**
- **N7 Calendar invites for 1:1s, rung 2:** every scheduled 1:1 emails both people a calendar invite (`.ics`), updated or cancelled when the meeting moves; a personal calendar feed link anyone can subscribe to from Google or Outlook. No account connection or two-way sync (needs registered apps with Google and Microsoft; with hosting at the earliest). The feed link is a secret per person, revocable: `security-review` in its slice.
- **N12 Goal grades (0.0–1.0), rung 2:** at the end of the year each goal gets a grade read from its measure (percent: progress; baseline to target: the share covered; milestones: the weighted share done), capped at 1.0. Shown on the goal, prefilled in the self and manager review in place of a per-goal rating typed by hand (D-16's optional objective rating); changing one needs a short reason. The plan's weighted grade is the attainment D-25's "rating disagrees with outcome" flag already reads. One number, three uses, no extra work for anyone.

**The user's V4 note, resolved:** "I dislike the friction of having to calibrate manually, if we can bypass that somehow cleanly without making a bad or illogical feature." **Calibration by exception** (D-35): as manager reviews come in, Fusion checks each against the round (D-25's computed flags: a lenient or harsh manager, a rating that disagrees with the goals' grades, a move of two levels since last year). A review with no flag is ready as rated: nobody has to open it. The session shows only the flagged ones, each with why; HR keeps a rating in one click or changes it with a reason. A round with nothing flagged goes straight to release. The full view (spread against the scale, the nine-box, drag to adjust) stays one click away for anyone who wants to look at everyone. Calibration stays a round component a company may switch off (D-15). This is logical, not a bypass: the reason to calibrate is inconsistency, and the flags are exactly the inconsistencies a session looks for; established practice (and HiBob's and Betterworks' tooling) already spends the session on outliers.

**Principle 9, from the user's note: Fusion does the bookkeeping.** Whatever Fusion can know or compute, nobody types, ticks or waits for: direction read from baseline and target; plan weights shared evenly until someone sets one, always totalling 100; grades read from measures; calibration by exception; release closes the round; launch lands on the next step; nominations go out without waiting; a review written from a draft of the year. Each step a person still takes is one they decide. Friction is judged in every explorer: for each screen, what does the person do that Fusion could have done?

**Agent's calls, from the answers:**
- **Values become their own list** (B-068 D-14 said values are the competency catalogue). With competencies per job family and level (D6 at 3), one list can't be both: a value is company-wide ("We own it"), a competency belongs to a role and a level. Starter values come with Performance; praise never waits on Settings.
- **Peer nominations go out straight away** (B-068 D-18 had the manager approve the list first): the manager sees the list and may change it while peers answer. One wait removed; oversight kept.
- **Weights:** each new goal takes an even share until the person sets one; setting one re-balances the rest; the total is always 100, never an error to fix. The same for contribution weights on calculated parents.
- **Probation reviews** stay out (V6 at 0, not pulled).

**Everything else** as picked on the page: heroes H1–H4 at rung 3 (Y2, Y3, G1, V2, V4 at 3); rung 2 for Y1, Y4, Y5, Y7, G2–G7, D2, D3, D5, V1, V3, V5, S2, S3, S5; rung 1 for D1 check-ins (a monthly reminder) and S6 (results export from the round); not doing N1–N6, N8–N11, N13, N14.

**What the slices will build** (board children of B-390, ordered by dependency in the slicing step after the explorers): the Year (B-405), Goals (B-406), conversations (B-407), reviews (B-408), calibration (B-409), starter content and competencies by job (B-410), Performance across Fusion (B-411); the design work is B-412. B-392 (broken functions) and B-389 (setup polish) fold into the slices that touch the same code.

## 8. Changes this scope makes to B-068

Confirmed at checkpoint 2 (2026-11-10), recorded as D-33–D-42 in `design/decisions.md` and logged in `archive/plans/B-068-decisions.md`:
- **D-01 phase**: the phase reads from events and dates (Planning → Execution → Review → Results out), never backwards; HR may move it on deliberately (rung 3).
- **D-14 praise**: a value becomes optional when the company has none, and starter values are offered.
- **D-23 calibration**: by exception, finalize what's ready, no "Discussed" tick to keep a rating (Q1, the V4 note).
- **D-30 notifications**: drafting steps don't notify; one notification per moment someone must act (Q3).
- **D-32 person summary**: Performance's own person page goes; the person page tab is the one place.
- **S-15 (B-069)**: Organization direction joins the sidebar as Goals › Company.
- **A12 one-off reviews**: probation reviews stay out (not pulled).
- **D-14 values** (added at the answers): their own company list, not the competency catalogue.
- **D-16 objective rating** (added): replaced by the goal's grade read from its measure, adjustable with a reason.
- **D-18 peer nominations** (added): go out without the manager's approval first; the manager may change the list.
- **Competency catalogue** (added): expectations per job family and level.

## 9. Questions for the user (taste and demo calls, also on the page)

Answered 2026-11-10: see §7b.

1. May HR finalize the reviews that are in before the rest? (recommended: yes)
2. The sidebar: Year · Goals · 1:1s · Feedback · Reviews (recommended), today's with Direction added, or by role (For you · Your team · Company).
3. Should drafting steps notify the manager? (recommended: no, only once put forward)
4. What the year is called on screen: its name ("2026"), "cycle", or "review year".
5. Which hero shines first.

Settled without a question (obvious from decisions already made): the manager works on Core HR's Team page (D-19); one person page (Core HR principle 1); Performance's records follow Core HR's language, with the layout of each redesigned surface decided in its explorer.

## 10. Sources

- Lattice, [Spring/Summer 2026 release: evidence-based AI reviews, AI in 1:1s](https://lattice.com/blog/lattice-spring-summer-2026-product-release); [product updates](https://lattice.com/product-updates/spring-summer-2026); [performance](https://lattice.com/platform/performance); [a new era in HRIS](https://lattice.com/blog/a-new-era-in-hris-redefining-the-employee-experience).
- Culture Amp, [What's new in Perform, 2026 Q3](https://www.cultureamp.com/blog/whats-new-perform-2026-q3) (cascading and weighted goals, AI Coach, probation reviews, feedback request lifecycle); [Perform refresh 2025](https://www.cultureamp.com/blog/perform-refresh-2025) (AI feedback summaries); [performance review calibrations](https://www.cultureamp.com/blog/performance-review-calibrations).
- Leapsome, [performance reviews](https://www.leapsome.com/en/product/performance-reviews); [talent suite](https://site.leapsome.com/product/talent-suite).
- 15Five, [Kona](https://www.15five.com/products/kona); [Kona for managers](https://success.15five.com/hc/en-us/articles/36196491046043); [perform](https://www.15five.com/products/perform).
- Betterworks, [vs Culture Amp](https://www.betterworks.com/betterworks-vs-culture-amp) (competitor page, read as such); [Brandon Hall on Betterworks](https://brandonhall.com/why-betterworks-is-thriving-in-the-performance-management-revolution/).
- HiBob, [performance management](https://www.hibob.com/talent/performance-management/) (calibration agent, standalone or integrated events, drag-and-drop 9-box, manager companion); [calibration sessions guide](https://www.glitter.io/guides/navigate-performance-calibration-sessions-in-hibob-pt2) (third party).
- BambooHR, [performance management](https://www.bamboohr.com/hr-software/performance-management); [Performance 1:1s](https://www.bamboohr.com/product-updates/performance-1-1s).
- Workday, [Start reviews with calibration](https://doc.workday.com/admin-guide/en-us/human-capital-management/talent/talent-and-performance-calibration/reviews-with-calibration/jai1395847529607.html); [calibration (education)](https://doc.workday.com/workday-education/en-us/course-manuals/talent-for-administrators/calibration.html).
- Fusion: [map](B-390-map.md), `archive/plans/B-068-decisions.md`, `archive/plans/B-069-surface-architecture.md`, `design/walkthrough-2026-11-09.md` §7, `Backend/EY.HRPlatform.Performance/Features/Progress/ProgressCalc.cs` (weighted roll-up).
