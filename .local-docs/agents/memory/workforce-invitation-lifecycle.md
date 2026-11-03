# Workforce invitation lifecycle

B-235, 2026-11-03: `WorkforceAccountsController.FindLatestInviteByEmployeeAsync` is a command lookup. Keep EF tracking: withdrawal, resend rotation and expired-invitation refresh mutate the returned entity. `AsNoTracking` saved the audit but silently lost lifecycle/credential changes. Regression fixtures must clear the tracker after setup and read back through another context.

Withdrawal takes an invitation-row lock before reading its state, matching acceptance's invitation-first lock order. A pending invitation is revoked durably; an accepted one is refused. Both selector/secret credentials and old raw-token links must fail acceptance after withdrawal. Re-invitation creates a new row/credential while the old row stays revoked. Resend rotates the stored credential; pending bulk invitations do not resend. Core's reminders use only InvitePending and one record per InviteId; scheduling and first-day rules stay in PeopleInvitations.

The frontend invitation lifecycle hook must invalidate `corePeople` as well as workforce caches: People rows, the Access tab and the invitation plan consume different query keys. `invitation-lifecycle.test.tsx` proves active list/profile reads refresh after withdrawal.

Repeatable live proof: `data/journey-b235-invitation-withdrawal.cjs` through shell :3000. It leaves the recorded fictional Ala invitation withdrawn, creates no account, and cancels its test schedule. Never persist raw invitation credentials in evidence or logs.
