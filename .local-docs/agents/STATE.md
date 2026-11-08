# STATE - live handoff

**Last finished:** B-325 Polish batch (B-323 chosen people in Change history, B-321 Performance lists inside the frame, B-250/B-274 sidebar fold), 2026-11-08, accepted 2026-11-08.

## Active work

**B-326** Cleanup batch (B-324 dead code: B-299, B-222, B-194, B-300; B-221 old administrator invitations; B-311 one definition per rule within each side). Plan: `plans/B-326-cleanup-batch.md`.

Plan set 2026-11-08; no code yet. Cold pickup, in a fresh session: follow the plan's Order. Step 1 decides B-299/B-221: trace whether platform recovery still uses `InvitationPurpose.TenantAdministrator`; remove it (schema-only migration on the invite purpose check) if nothing reaches it, else keep it and expire pre-B-178 invitations. Then B-194 endpoints, B-222 Core HR leftovers, B-300 wording, B-311 password rule to one frontend source plus a short sweep. Checks: full Identity + CoreHR suites, touched frontend tests; one commit (board files included); every item closes ○ with its evidence.

## Next

Not set: take it from the user or the board.
