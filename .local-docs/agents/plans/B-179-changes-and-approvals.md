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
