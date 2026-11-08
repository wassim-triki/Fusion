# B-325 Polish batch

User 2026-11-08: "lets target the full polish bag" (the board's Ready › Polish group).

| Item | What | Taste | Session |
|---|---|---|---|
| B-323 | Change history says who was chosen for a role or taken off it | Rows in the accepted Change history | 1 |
| B-321 | The 1:1 record, Reviews and the round page: lists with their titles inside the frame, like B-228 | B-228's accepted pattern | 1 |
| B-250 + B-274 | The sidebar collapse/expand toggle | Rejected twice on taste: drawing first | 2 |

## Session 1: B-323 + B-321
- B-323: Identity's `access.profile.updated|created|deleted` record adds `chosen` (user id + name of each holder chosen by name). Change history compares before and after and says "Gave X the Managers role" / "Took the Managers role from X" with the existing words; older records without `chosen` keep "Changed the Managers role".
- B-321: Performance `PlanSection` (1:1 record: talking points, actions, notes, past meetings) and `SectionHeading` (Reviews page, round page) become DS `Section` with the rows inside, as B-228 did; then both components are deleted.
- Tests: Identity role-save record carries `chosen`; core change-history lines; performance touched tests. Screens: 01 Change history chosen line, 02 1:1 record, 03 Reviews page.

## Session 2: B-250 + B-274
- An explorer artifact with the toggle variants in the real sidebar (expanded and collapsed, dark), the two rejected attempts named so they aren't repeated. User picks, then build.
