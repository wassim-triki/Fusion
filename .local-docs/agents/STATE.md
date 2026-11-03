# STATE - live handoff

**Last finished:** Completed-work commit batch and B-246 handoff, 2026-11-03. Last product acceptance: B-278, Settings work-week selector, closed.

## Active work
None. User requested committing and pushing the completed work before the B-246 fresh session. Publication target: `origin/wassim/develop`; current commit completes the four-part batch (invitation lifecycle, shared UI cleanup, Core HR front page, company work week/self-manager). Required lint/types run through normal hooks with concurrency one. B-190 and Home reviews stay In review; B-278 stays accepted/closed. Next: B-246, still Ready; no implementation started. Check git/upstream status at pickup rather than relying on earlier recorded hashes.

## Next — fresh-session pickup
Recommended effort **xhigh**: import data integrity and temporal workforce dates. Handle B-246 end to end, then stop; other follow-ups stay queued. Read AGENTS in full, this STATE, BACKLOG, memory index, DESIGN, accepted import/day-one decisions and B-186/B-187/B-188 notes. Inspect git status/diffs, activation's first-person creation, import matching/review/publish/retry and canonical employment/assignment/manager date contracts before editing.

Offer the file's earlier start date when import matches the activation-created first administrator and the record has not been changed since day one. Make the offer reviewable, keep the existing date unless chosen, enforce eligibility/tenant/permission on the server and recheck at publish. Preserve canonical effective intervals and reporting relationships rather than changing an isolated field. Define the untouched-record predicate from existing provenance/history evidence, not a UI heuristic. Cover changed/ineligible records, missing/later dates, stale review and idempotent retry as relevant to the implemented rule.

Preserve the committed B-190/B-235/B-276/B-247/B-248/B-278 baseline and any new uncommitted work, accepted scheduling and repaired invitations. No stage/commit/push/stash/reset for B-246 without a new instruction. B-190 explicitly remains In review; Home reviews remain open; sidebar B-250/B-274 and Add a person B-239 deferred. Use DS and EN/FR/AR, fusion-dev stack/backend tests/API through :3000, security-review for changed authorization/tenant/write boundaries. Scoped verification: touched tests during work, one final full suite per changed backend service, touched frontend tests, affected lint/types; heavy jobs sequential, cold build only for routes/layouts/config. No B-190 journeys/screens. Only new/touched UI captures, dark 1440×900. Keep STATE/BACKLOG current and exact commands/counts in LOG; leave stack running.

## Where it stands
B-278 accepted: Core touched tests **18/0/0**, DS choices **7/0/0**; four Core/DS lint/type checks and catalogue parity pass. Live save/discard/preset/reload/restoration **8/0/0**, settled capture **3/0/0**. Original company week restored. Earlier callback failure and capture-timing correction recorded in LOG. Review plan/screens archived locally. Closure changes documentation only; no tests, stack operations or screenshots repeated.

B-247: working-day choices in Settings › Details, persisted in Core HR’s existing tenant-settings JSON through the versioned organization save, default Monday–Friday, company-management permission enforced. Narrow member read feeds Home’s company card (D-09).
B-248: ordinary employees read their own canonical current primary manager, without management permissions; token-only subject/tenant, dated resolver and fail-closed filters. Minimal name/title plus current employment’s first-week flag. Home’s joiner card follows D-12, with loading/empty/error/retry states. EN/FR/AR throughout.

Review [work week](plans/B-247-company-work-week.md) and [joiner manager](plans/B-248-joiner-manager.md): Settings › Details as Carthage’s administrator; setup Home as the existing Fresh administrator; joiner Home as the fictional ordinary employee in the review guide and local `data/b247-b248.local.json`. Exactly three dark 1440×900 captures inspected, no retakes.

Final evidence: CoreHR **464/0/0** (one full suite, relational on); focused backend **27/0/0**; touched frontend **42/0/0**; shell API **30/0/0**; rendered assertions **5/0/0**. API/core/shell lint and types, catalogue parity, UTF-8 scan and diff check pass. Earlier compile/test/harness failures and the corrected test import warning are recorded with exact commands in LOG. Security-review: no high-confidence vulnerabilities identified. No Next route/layout/config changes, so no cold build; no other backend service changed.

**B-190 remains In review, explicitly not accepted.** Prior B-190, completed B-235/B-276 fixes, accepted B-238/B-275 scheduling and repaired invitation lifecycle are preserved. Sidebar B-250/B-274 and Add a person B-239 remain deferred. No dedicated B-190 tests, journeys or screenshots repeated; the required final CoreHR suite naturally includes existing service tests. B-277’s existing archive collision was reported by stack startup and left unchanged.

Stack target remains Gateway, Identity, CoreHR, Performance, Mailpit and shell/core running. Frontend is managed through fusion-dev and temporarily stopped for commit-hook memory, then restored at publication's end. Existing B-189 archive collision preserved. Previous 50737fc8 baseline is superseded by this commit batch; inspect current HEAD/origin rather than using it as the latest hash. All earlier work is preserved. Standalone preview probes are archived locally in `archive/data/`, with design captures/plans in `archive/plans/`; reusable API/browser journeys remain tracked.

## Open questions & blockers
No implementation blocker. Remaining Home review pending for B-247/B-248 and independently B-190.
