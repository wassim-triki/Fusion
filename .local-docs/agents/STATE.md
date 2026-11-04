# STATE - live handoff

**Last finished:** B-286 batch 2 ✓ 2026-11-04: Home company/people card, joiner manager card, B-280 loading, filled work-week chips (commits 9c2fde0d, c0b5c26d). Batch 1 (B-190, B-284, B-285) done earlier the same day.

## Active work

None.

## Next

B-286 batch 3, in a fresh session: review B-246 (the first person's imported start date: Keep vs the file's earlier date in the import review's Also to check, and the Start date row in Changed). Same method: read commit 97209af5, open the prepared review as the fictional administrator in local `data/b246.local.json` (password: `FUSION_LOCAL_PASSWORD`), compare with D-22/D-23, fix in the same pass, then send the user screenshots or sign-in details. Then B-286 closes.

## B-246 review
[Guide and capture](plans/B-246-first-person-start.md): use the fictional administrator and session in local `data/b246.local.json`. Also to check shows activation day versus the earlier file date; Keep is the default, Take leans keeps it, and choosing the file date appears in Changed. Fixture currently selects the file date without publishing. A second fictional tenant's import is published and proves historical tenure, assignment and reporting dates.

Activation records authoritative provenance. Eligibility comes from canonical rows/history, never the frontend. Older records without positive provenance are ineligible. Publication rederives, locks/revalidates original tenant-qualified rows and extends employment plus original assignment atomically with the frozen plan. Reporting lines retain canonical temporal rules; rollback/retry and later edits covered. EN/FR/AR.

Final evidence: full CoreHR **470/0/0** (one final suite, relational on); focused **13/0/0**; touched frontend **9/0/0**; resumed shell API **17/0/0**; capture **1/0/0**, dark 1440×900, inspected. Core/API lint and types (four checks) plus message parity pass. Earlier test, compile, type and journey failures, fixture recovery and successful reruns are recorded in LOG. Security-review: no high-confidence vulnerabilities identified. No migration, Identity change or route/layout/config change; no cold build.

B-279 queues reproduction of a first dated-profile assertion failure whose response was not captured; direct and final resumed reads were correct, without repeating publication. No cause established. Do not start that follow-up in this task.

## Preserved reviews and deferrals
B-190 remains **In review, not accepted**. B-247/B-248 Home reviews remain open. Accepted invitation scheduling, repaired lifecycle and B-278 selector preserved. B-250/B-274 sidebar and B-239 Add a person stay deferred. No dedicated B-190 journeys/screens repeated. B-277's existing archive collision preserved.

## Runtime

Fusion-dev left development Shell + Core running, with Gateway, Identity, CoreHR, Performance and Mailpit UP. Final shell API chain401 expected; RAM2.3GB available. Production verified Shell plus one MFE sequentially, then original stack script restored byte-for-byte and dev restored. All diagnostic browsers/holds closed, own executable probes and saved stack backup removed. Sanitized JSON/logs and three temporal frames remain local/ignored in data/.work/b280-fix/. No product instrumentation, permanent stack override, stage/commit/push/stash/reset. Exact commands, initial failures/corrections and final outcomes are in LOG.
