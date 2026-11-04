# STATE - live handoff

**Last finished:** B-246 — The first person's imported start date, locally committed and still In review, 2026-11-04. Base `f70688de` on `wassim/develop`; use git log for the resulting commit hash. No push requested or performed. Normal hooks: lint **11/0/0**, types **11/0/0**.

## Active work
None. B-246 stays In review; do not start queued follow-ups. User's recalled generic-to-page skeleton flash is recorded in the older loading-architecture memory and restored as queued B-280, without implementation.

## B-246 review
[Guide and capture](plans/B-246-first-person-start.md): use the fictional administrator and session in local `data/b246.local.json`. Also to check shows activation day versus the earlier file date; Keep is the default, Take leans keeps it, and choosing the file date appears in Changed. Fixture currently selects the file date without publishing. A second fictional tenant's import is published and proves historical tenure, assignment and reporting dates.

Activation records authoritative provenance. Eligibility comes from canonical rows/history, never the frontend. Older records without positive provenance are ineligible. Publication rederives, locks/revalidates original tenant-qualified rows and extends employment plus original assignment atomically with the frozen plan. Reporting lines retain canonical temporal rules; rollback/retry and later edits covered. EN/FR/AR.

Final evidence: full CoreHR **470/0/0** (one final suite, relational on); focused **13/0/0**; touched frontend **9/0/0**; resumed shell API **17/0/0**; capture **1/0/0**, dark 1440×900, inspected. Core/API lint and types (four checks) plus message parity pass. Earlier test, compile, type and journey failures, fixture recovery and successful reruns are recorded in LOG. Security-review: no high-confidence vulnerabilities identified. No migration, Identity change or route/layout/config change; no cold build.

B-279 queues reproduction of a first dated-profile assertion failure whose response was not captured; direct and final resumed reads were correct, without repeating publication. No cause established. Do not start that follow-up in this task.

## Preserved reviews and deferrals
B-190 remains **In review, not accepted**. B-247/B-248 Home reviews remain open. Accepted invitation scheduling, repaired lifecycle and B-278 selector preserved. B-250/B-274 sidebar and B-239 Add a person stay deferred. No dedicated B-190 journeys/screens repeated. B-277's existing archive collision preserved.

## Runtime
Fusion-dev manages shell/core plus Gateway, Identity, CoreHR, Performance and Mailpit. The frontend is restored after normal commit checks with `stack.ps1 -Only Frontend -Apps core`; leave the stack running at handoff. Other services preserved. Browser capture process closed. Exact implementation and commit checks are in LOG; git status/log and stack status are authoritative.
