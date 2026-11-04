# STATE - live handoff

**Last finished:** B-190 Core HR front page ✓ 2026-11-04 (batch 1). Earlier: B-280 loading repair, including Shell Home, 2026-11-04; Home part still **In review**. [Diagnosis, implementation, timed evidence and review guide](plans/B-280-loading-investigation.md). Uncommitted on wassim/develop, last product commit remains local 97209af5 (B-246, In review). Initial handoff changes preserved.

## Active work

**Review batches (Claude, 2026-11-04).** Batch 1 done: B-190 ✓, B-280 Core/Performance/Platform accepted, fixes committed. Next: batch 2 = Home (B-247 company card + B-248 manager card need a redesign, the user rejected their look 11-03; plus B-280 Home, then commit B-280); batch 3 = B-246. User also wants B-284/B-285 closed (order to confirm).

## Next

Human look at B-280: refresh Home and the investigated Core People/worker, Performance 1:1 list/series and Platform Tenants/record routes. One canonical pending shape now spans access and primary data loading; Home retains its frame. Readiness/auth decisions remain fail closed; no artificial delays, early protected pages, cache widening or domain/API changes. Targeted tests **160/0/0**, four cold builds including lint/types, production browser **41/0/0**, development **19/0/0**, read-only API **8/0/0** plus anonymous header context401. Scoped security-review: no high-confidence vulnerabilities.

Eight production controls confirm exact skeleton geometry and actual main DOM through SSR→hydration/data pending→zero skeletons, main [264,49,1176,851]. Dev Core/Home confirms the same despite cold compilation. BFCache restoration, an actually painted target-path automatic fallback and exhaustive other-route/persona parity remain unclaimed. Known photo404s remain B-281 (six paths); existing stale-hint sign-in recovery queued B-282 and early Performance header context request queued B-283. Do not fold those into accepted loading evidence. Other reviews and queued work below retain their verdicts.

## B-246 review
[Guide and capture](plans/B-246-first-person-start.md): use the fictional administrator and session in local `data/b246.local.json`. Also to check shows activation day versus the earlier file date; Keep is the default, Take leans keeps it, and choosing the file date appears in Changed. Fixture currently selects the file date without publishing. A second fictional tenant's import is published and proves historical tenure, assignment and reporting dates.

Activation records authoritative provenance. Eligibility comes from canonical rows/history, never the frontend. Older records without positive provenance are ineligible. Publication rederives, locks/revalidates original tenant-qualified rows and extends employment plus original assignment atomically with the frozen plan. Reporting lines retain canonical temporal rules; rollback/retry and later edits covered. EN/FR/AR.

Final evidence: full CoreHR **470/0/0** (one final suite, relational on); focused **13/0/0**; touched frontend **9/0/0**; resumed shell API **17/0/0**; capture **1/0/0**, dark 1440×900, inspected. Core/API lint and types (four checks) plus message parity pass. Earlier test, compile, type and journey failures, fixture recovery and successful reruns are recorded in LOG. Security-review: no high-confidence vulnerabilities identified. No migration, Identity change or route/layout/config change; no cold build.

B-279 queues reproduction of a first dated-profile assertion failure whose response was not captured; direct and final resumed reads were correct, without repeating publication. No cause established. Do not start that follow-up in this task.

## Preserved reviews and deferrals
B-190 remains **In review, not accepted**. B-247/B-248 Home reviews remain open. Accepted invitation scheduling, repaired lifecycle and B-278 selector preserved. B-250/B-274 sidebar and B-239 Add a person stay deferred. No dedicated B-190 journeys/screens repeated. B-277's existing archive collision preserved.

## Runtime

Fusion-dev left development Shell + Core running, with Gateway, Identity, CoreHR, Performance and Mailpit UP. Final shell API chain401 expected; RAM2.3GB available. Production verified Shell plus one MFE sequentially, then original stack script restored byte-for-byte and dev restored. All diagnostic browsers/holds closed, own executable probes and saved stack backup removed. Sanitized JSON/logs and three temporal frames remain local/ignored in data/.work/b280-fix/. No product instrumentation, permanent stack override, stage/commit/push/stash/reset. Exact commands, initial failures/corrections and final outcomes are in LOG.
