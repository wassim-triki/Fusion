# STATE - live handoff

**Last finished:** batch B-205, B-287, B-240, B-200, B-236 (invitation pages in the company's frame, filled roles, directory card, list drag, tenant export), 2026-11-07, accepted.

## Active work

**B-239** Restyle Add a person (`/core/people/add`), with B-312 (fill an open role under the chosen manager) folded in. Canvas first.

- Plan: study the current page + what it collects, BambooHR/Personio/HiBob new-hire flows; one interactive artifact (dark 1440x900) with 2-3 directions, Carthage data, live person-card + first-day preview, empty/error states; recommendation marked.
- This session: artifact only, no product code; commit board files only. Then stop for the user's pick.
- Done 2026-11-07: explorer `plans/B-239-add-person.html` (https://claude.ai/artifact/BjbZDN2Lx3fT4VUjgF5Va7), directions A (one page, live preview beside: card, first day with invite + dated joining checklist, manager's team with the open slot) recommended, B (guided flow), C (record band). States: fresh, typing, ready, missing, same person, couldn't save, already works here; toggle for a company-required field.
- Design facts for the build: manager first in "Their team", unit defaults from the manager; "Fills the open <job> role" (B-312) fills job/unit/first day from the role and marks it filled from the first day; invite now / on the first day / later (later only without email); taken work email errors at the field; name match card with "Add anyway"; company-required custom fields (`EmployeeFieldDefinition.Required`) join "Who". Hire contract today has no open-role id, invite timing or custom-field values: the build adds them.
- **Picked 2026-11-07: C** (user: "C for sure"): the record band before it exists. Name typed into the band title, job under it, glance row Manager · Unit · Starts · Place; rail Contact + Job (type, number, required company fields); main: "<first name> is hiring" open-role section, Coming up (first day, invite timing on its title line, dated joining checklist), the manager's team with the slot. Other taste questions unanswered: take the recommendations (open role under the manager; after Add open their page with Add another in the toast).
- Next: a fresh session builds C end to end (backend: open-role id, invite timing and required custom-field values on hire/add-existing; frontend: port the C drawing literally), one screen to compare with the drawing, then In review.

## Next

Not set: take it from the user or the board.
