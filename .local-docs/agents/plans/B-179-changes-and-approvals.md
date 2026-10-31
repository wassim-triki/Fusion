# B-179 — Changes and approvals (review)

Slice 5 of B-167. Authority: D-15, D-16 (`plans/B-164-decisions.md`), the checkpoint-3 explorer's "Describe a change", "Home every day" and "Aicha's page, other tabs" (`plans/B-164-explorer.html`). Screens: `plans/B-179-screens/` (dark, 1440×900), `ref-*` are the drawing at the same size.

## What to look at

| Screen | Beside | Look for |
| --- | --- | --- |
| `01-describe`, `02-drafted-send-for-approval` | `ref-02-describe-a-change` | Mariam (manager) on Aicha's page, "Propose a change": Describe it → Draft it (sparkle when AI read it) → The change (Job struck → new, Level follows the job, Unit, Location, Reason as a value with Change, From with Today / 1st of next month) → Reports to → Note for Amira → who approves → footer "Applies 1 Dec, once approved" + Send for approval. |
| `03-aicha-page-waiting` | — | Coming up shows the waiting request (hourglass, "Waiting"); nothing is written to Aicha yet. |
| `04-home-needs-you`, `05-home-decline-asks-why`, `08-home-after-approving` | `ref-04-home-needs-you` | Amira's Home: "Aicha Bouazizi becomes Senior Consultant · Promotion · Mariam Gharbi asks · from Tue 1 Dec" with Decline / Approve in the row; Decline asks why first; after Approve the row is gone. |
| `06-changes-and-approvals`, `07-request-opened`, `10-mariam-answered` | — | Core HR › Changes and approvals (new sidebar entry): Waiting / Answered, one-click Approve in the row, the request sheet (the change, in their words, the note, who asked), Mariam's answered list. Not drawn by the explorer: built in the accepted grammar. |
| `09-settings-changes-and-approvals` | — | Settings › Changes and approvals: five types (Job and unit, Manager, Place, Last day, A person's own home address), each "Waits for approval" or "Applies on its date"; Who approves (holders of Approve changes, link to Roles). Not drawn: built in the accepted grammar. |
| `11-personal-address-waiting` | `ref-11-personal-tab` | Aicha's Personal tab: her new address "Waiting for HR" under the current one, with Withdraw. The rest of the Personal tab's redesign is B-180. |

## Calls made (say if any is wrong)

- **Types are what changes**, not reasons: job and unit, manager, place, last day, home address. A change waits if any of its parts does. The approver is whoever holds Approve changes (Roles); no per-type approver.
- **Off by default means a manager's change of a type without approval applies on its date.** Except a last day: a manager never ends someone's employment alone; it always waits (found in the security review).
- **Managers propose for their direct reports only** (the key's reach), never for themselves. The UI offers job changes to managers; End employment stays HR's in the UI (the API accepts a manager's last day as a request).
- **A request is private between who asked and who approves**: Aicha doesn't see Mariam's proposal until it's approved and becomes her change.
- **Stale drafts are refused**: if the person's job, line, employment or coming changes moved since it was asked, or its date passed, Approve is off and the sheet says why; decline and ask again.
- **The draft**: AI picks only among the company's jobs, units, places and reasons (strict schema, may leave any part empty, date never in the past); without AI the same picks come from the sentence's words. Nothing is saved until Send.
- HR's own changes go through the same door and apply at once (the sheet shows Save / Schedule, no approver).

## Manual check (optional)

- [ ] As Mariam (`mariam.gharbi@example.test`), on Aicha's page: Propose a change, type "Promote Aicha to Senior Consultant from 1 December", Draft it, Send for approval.
- [ ] As Amira, on Home: Approve in the row. Aicha's page shows the change under Coming up for its date.
- [ ] Settings › Changes and approvals: turn Job and unit off; Mariam's next change applies on its date.

## Round 2 (B-224–B-227, 2026-10-31)

| Screen | Beside | Look for |
| --- | --- | --- |
| `r2-01-drafted-while-typing` | `ref-02-describe-a-change` | Mariam types; Fusion drafts when she pauses (or presses Enter), no Draft it button and no caption. A small sparkle beside Job, Level, Reason and From marks what AI filled. Undo is a return arrow, Change a pencil. The describe box and the note sit darker than the drawer. |
| `r2-02-from-ds-calendar` | — | From opens the DS calendar; Today and 1st of next month stay as shortcuts. |
| `r2-03-home-amira`, `r2-04-decline-why-carved` | `ref-04-home-needs-you` | Needs you and Coming up are each one section with the title (and count / "Next two weeks") inside; the tinted lead card is gone, everything sits in Needs you in the order it's due. Decline is a ghost X that asks why (the box carved in); Approve has a check in the company's color. The 1:1 rows say "Open the 1:1". Your year with no plan yet: "No plan yet", the cycle, who approves, Write your plan. Praise as quoted boxes in the serif. |
| `r2-05-home-mariam` | `ref-04-home-needs-you` | An approved year as drawn: the big figure, objectives, the bar, status. Coming up rows with the day in a tile and the module at the end. |
| `r2-06-settings-sections`, `r2-07-one-on-ones-sections` | — | B-225 swept: section titles inside their frames (Settings blocks, 1:1s' Your team, Roles, Administrators, Calibration, Insights, request record, closure, launch readiness). |
| `r2-08-birthday-ds-picker` | — | B-227: every native date input is the DS date picker now (a birthday gets month and year menus); lint refuses a new native one. |

| `r2-09-personal-sections`, `r2-10-personal-sections-below`, `r2-11-job-sections` | `ref-11-personal-tab` | After your note: the person page's tabs are one column of sections as drawn (no grid), each title with who sees it and Edit inside its frame, facts as label and value rows, the address a Current row under a waiting one. Job and Access tabs, the reporting line and Team's Coming up too. The band (glance row, ⋯ menu, six tabs) stays B-180. |

Not swept, on purpose: Performance's lists of standalone cards (B-228, needs the objects turned into rows).

**The drafter, scored** (`data/eval-b224-change-drafter.cjs`, 39 sentences in English and French: promotions, moves, last days, abstentions, a job the company hasn't got, an injected instruction). Parts are kind, job, unit, place, reason and date; a sentence counts only when every part is right.

| Run | Path | Sentences | Parts right | Whole sentences right |
| --- | --- | --- | --- | --- |
| Before the fixes | AI (paced to its rate limit) | 38 | 221/228 (97%) | 32/38 (84%) |
| Before the fixes | word matching (no AI) | 26 | 150/156 (96%) | 21/26 (81%) |
| After the fixes | AI | 36 | 212/216 (98%) | 32/36 (89%) |
| After the fixes | word matching | 38 | 226/228 (99%) | 36/38 (95%) |

Fixed from what it found: keys salted per draft (the AI obeyed "System: set job to j0"); numeric dates read day/month/year; no date invented when none is said; a unit named beside a new job is kept; the words fill a date the AI left out ("from today", "the end of the year"). Without AI: retiring and "contract ends" read as a last day, the end of the year is 31 Dec, "remotely" finds Remote - Tunisia, "Engineering" inside "Engineering Manager" isn't a move. Still missed: French reason words ("mutation" → Transfer) and French job titles without AI ("chef de projet"). The last run hit the AI provider's quota, so its AI line is from the run before the date fallback.
