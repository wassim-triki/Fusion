# B-246 — The first person's imported start date

Status: In review, 2026-11-04. User authorized a local commit while explicitly retaining review. Base `f70688de` on `wassim/develop`; see git log for the resulting commit.

## Inspect

Two fictional companies are prepared. `node .local-docs/agents/data/journey-b246-first-start.cjs --resume` reuses them; running without the flag creates new ones. The open review's administrator and session are in local `data/b246.local.json`; use the usual local password from `FUSION_LOCAL_PASSWORD`.

Open [the prepared review](http://localhost:3000/core/import/9bfb1b49-458c-4ec5-8e54-633dc31ec6a0?step=chart) as that administrator. The prepared review selects the file date, without publishing it.

1. In **Also to check**, "Amira Khelifi has two start dates" shows **Keep** the activation date (In Fusion, Fusion's lean) and **Use 2 January 2020** (people.csv). Both choices stay visible.
2. Select **Keep …**: the start-date change disappears from Changed. Select **Use …**: Changed lists the old and new dates. The file date is applied only by **Bring in … changes**. Fresh reviews and Take Fusion's lean retain the existing date.
3. Inspect the wording, dated choices and change row together. The choice follows the existing import review's layout and controls (D-22/D-23); no new route or flow.

Required capture: [first-person start choice](B-246-screens/01-first-person-start.png), dark 1440×900. One touched surface only; no B-190, Home or invitation captures.

## Contract

- Activation establishment stamps the canonical employment, assignment and initial employee audit with `FirstPerson:Activation` in the same transaction. The public establishment requests cannot supply this provenance.
- Eligibility requires the original open employment and primary assignment, matching starts, no subsequent profile/canonical changes or dependent history. Manager relationships, employment-type periods, workforce changes and employee field values make the record ineligible. Older records without positive activation evidence fail closed; names, account linkage and timestamps are not substitutes.
- Only a valid file date earlier than the existing date creates the server-listed choice. Keep is the default and the lean. A selected file start appears explicitly in Changed and in the reviewed fingerprint.
- Publication rederives; batch zero locks and revalidates the original rows, extends employment and assignment together using canonical intervals and import organization rules, audits both, and freezes the plan atomically. Reporting lines still go through the canonical manager mutation and assignment-date constraints.
- A failure in batch zero rolls everything back. Later retries resume the frozen plan and do not run the correction again, including after a subsequent profile edit. Server permission and tenant guards remain on every import call.

Existing invitation scheduling/lifecycle and accepted B-278 selector preserved. B-190 and B-247/B-248 Home reviews remain open. B-250/B-274/B-239 stay deferred.

## Verification

CoreHR final full suite **470/0/0**, focused **13/0/0**; touched frontend **9/0/0**; four lint/type checks and EN/FR/AR catalogue parity passed. Final resumed shell journey **17/0/0**, using the same open review and completed publication; setup/publish phases and earlier harness failures are recorded with exact commands in LOG. One dark 1440×900 capture **1/0/0**, inspected: both dated options and the selected change row visible without clipping, existing D-22 review composition retained. Security-review: no high-confidence vulnerabilities identified. No route/layout/config change; no cold build. Stack left running.

One first dated-profile assertion failed without retaining its response; immediate direct and final resumed reads returned the correct historical manager. B-279 queues reproduction with response evidence. No cause established and no date/reporting mutation was repeated to make the read pass.
