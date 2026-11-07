# STATE - live handoff

**Last finished:** B-313 (B-212 "their unit" last), 2026-11-07, accepted.

## Active work

**B-319** batch: B-315 manager told about leave, B-316 past leave in Job and history, B-317 shell Home tests. One fresh session, one commit; In review at the end for B-315/B-316 (UI and wording), B-317 closes on evidence.

Cold pickup (nothing started yet):
- **B-317** first (smallest): `Frontend/apps/shell/src/features/home/fusion-home.test.tsx` renders `TopBarSearch` (since `20c3f0b1`), which needs an `AuthProvider`; wrap or mock it as the other shell tests do. Prove with `pnpm --filter shell exec vitest run src/features/home` (18 failing today).
- **B-315**: follow the team joining/leaving pattern: `CoreNotificationKind` in `Backend/EY.HRPlatform.CoreHR/Domain/Entities/CoreNotification.cs`, moments in `Features/Notifications/CoreChangeMoments.cs` (TeamJoining at ~97/161), words in the Core notification catalog (en/fr/ar) and the branded email (B-204). New kind for leave set/changed/ended early/cancelled for the person's current manager (not when the manager set it themselves); leave type shown to the manager. A proposal that waits notifies on apply, not on proposing. Tests: the manager gets one, another tenant's manager and the actor don't.
- **B-316**: ended leave on Person › Job and history (`Frontend/apps/core/src/features/people/components/worker-profile/job-tab.tsx`), as the B-313 explorer draws it (`plans/B-313-explorer.html`, Aicha's page "back" state). Backend: past `WorkforceChangeKind.Leave` rows (`Features/People/Changes/Leave.cs`, `LeaveReader`) into the job history read with the same visibility as today (type for HR, the manager and the person). One screen of Aicha's Job tab after leave (dark 1440x900).
- Checks: CoreHR suite once; core touched tests; shell home tests; no journey (no authz change beyond who is notified, covered by tests).

## Next

Not set: take it from the user or the board.
