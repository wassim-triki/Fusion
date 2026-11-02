# B-189 — Reports

Review at [Core HR › Reports](http://localhost:3000/core/reports), in Carthage Digital Group. Reference: explorer 3, Reports (`B-164-explorer.html`, D-14).

## Look at

- As Amira, compare Headcount with the drawing: report rail, date/range controls, grouping, legend, stacked bars and the period table. Switch to a date, then a range; group and filter using real values; pick fields with the sliders control.
- Save a report; open it under Yours, change it and save changes. Share with Managers, then export CSV or Excel. "Engineering by place" is already saved and shared for the review.
- As Mariam, open that shared report: only her current management branch appears; there are no save/share controls with her See access. As Leila, Reports is absent from navigation and the API refuses access.
- Settings › Roles › Managers: Reports now offers See or Build, for their team or everyone. Sharing gives access to a definition; it never widens the viewer's Reports reach or field access.

## Semantics

Headcount, Jobs and Where people work count people at each period end. Joiners and leavers use their event dates and dated assignments; consecutive renewals do not count as exits and entries. Turnover is departures divided by the mean of opening and closing headcount, as a percentage. Time with the company is mean years. Team reach follows the viewer's current branch, including when reading past dates. Employment, work and units are dated; company field values use the values currently recorded by the Fields feature. Open roles follow Organization's existing rule: current plans, from today onwards.

The chart, page and both exports use one reporting engine, ready for the Core HR front page. A saved definition carries no data access. Hidden fields cannot be returned, grouped, filtered or exported; even the definition's filter literals are withheld if their field is no longer visible.

## Verification

- `test-backend.ps1 CoreHR`: **446 passed / 0 failed / 0 skipped**, relational on.
- `test-backend.ps1 Identity`: **571 / 0 / 0**, relational on.
- Targeted CoreHR Reports/FirstPerson/WorkforceController checks after temporal metric tightening and interface updates: **27 / 0 / 0**. Final report checks: **10 / 0 / 0**, including Jobs-only administration denied HR-only personal fields. Final Identity role checks after extending the existing read grant: **17 / 0 / 0**.
- Core touched tests (Reports, roles model, sidebar): **9 passed**. Auth roles tests: **18 passed**. EN/FR/AR catalogue keys match.
- `pnpm --filter core build`: **passed**, including `/reports` and `/reports/[id]`. Earlier compile/test-mock failures were corrected; new Reports lint warnings were removed. Remaining build warnings are in the existing Brand files.
- The first targeted backend run was refused by the memory guard (1.5 GB free); it was not repeated. Frontend was stopped for the successful backend suites and cold build.
- Security review: tenant filters on saved reports and shares; branch before aggregates; viewer field policy on definitions, filters, results and exports; owner and Build on writes; signed Identity role reads; tenant-owned role IDs on sharing. Found and fixed a Jobs-only administrator gaining HR-only personal field access; job and personal field audiences are now separate. No remaining high-confidence vulnerabilities identified.

- `node .local-docs/agents/data/journey-b189-reports.cjs`: **18 passed / 0 failed / 0 skipped**, against the live stack, including manager-only people and both exports, See-only write refusals, no-Reports employee refusals, foreign saved-report IDs and foreign role IDs.
- Three dark **1440×900** captures, one per new surface: Reports, Save as, Share, in `B-189-screens/`. Compared with the original explorer Reports frame. The comparison captures precede the final spacing corrections (no retakes): the group column no longer wraps, Change fits, Fields is in the header, compact matrix rows and no unnecessary pager. Final DOM measurements: table/frame/scroll width **792/792/792px**, group column **200px**, row **43px**, table bottom **776px**, page width **1440px**. Tenant colour, real data (including the person in the root unit), and existing shell navigation differ from the drawing.
- The existing report read grant is extended to team reach; configured HR roles retain their read access. Build is a separate grant. Jobs and Personal details each keep their own field audience.
- The single commit's hook runs lint and type checks for our apps and packages; result recorded in the completion reply.

## Review fixes — B-251 (2026-11-01)

User notes: no clear CTA theming; use the earlier rebuild's filters; Fields should not sit with Share/Save/Export; date/group controls need the reference's lighter fills; use the existing range calendar; save/share need complete flows.

Addressed with shared FilterFieldChip value menus (options come from the same viewer-scoped reporting engine), Fields in the configuration row, secondary fills on date/group/interval controls, and the shared two-month DateRangePicker with month/year dropdowns and locale support. Incomplete ranges are not run and are discarded on dismissal. Save is the primary themed action; Save changes updates the record, Save as makes a private copy, and standard Share saves and shares in one submission. Pending edits are saved before sharing; a successful save is kept if sharing fails, so retrying does not create another report. Sharing shows the recipient reach consequence and requires recipients for a private report; clearing existing recipients says Stop sharing. Saved definitions and sharing state update the local cache immediately.

Look at the same Reports page: configuration separate from header operations, chip filters rather than text entry, the range calendar, Save versus Save as, standard Share and its retry state. No clarification was needed; these were Reports-specific gaps rather than work already waiting elsewhere on the board.

Checks: `pnpm --filter core exec vitest run src/features/reports/reports-workspace.test.tsx --maxWorkers=2` **6 passed / 0 failed**; `pnpm --filter core type-check` passed; `pnpm --filter core lint` passed (existing Brand warnings); `pnpm --filter @repo/ds lint` passed with zero warnings; catalogue parity passed. No backend/auth/route changes, so no backend rerun, journey, cold build or screenshot retakes. Follow-up changes left uncommitted.

## Filter interaction follow-up (2026-11-01)

Look at the Reports page: select several units or skills, search within a filter, use the keyboard, remove the last choice, clear filters, search Fields, and switch between one date and a range. Choices come from all periods of the report and the viewer's permitted people and fields; tag fields offer individual tags. The date and field limits are enforced before a report is submitted.

Evidence: Core frontend full suite 173/0; shared suite 97/0 after correcting stale Settings test expectations. Shared filter tests 4/0 and date range tests 2/0. Reports backend tests 12/0/0 (relational enabled), including tenant, branch and hidden-field negatives; read-only live viewer journey 6/0/0. Core and shared type checks passed; Core and shared lint passed (existing Core Brand warnings). Security review found no high-confidence issues. Live Skills multi-select, results, clearing and field search checked as Amira; the page is left open.

The full CoreHR suite was refused by its memory guard with 1.8 GB available against 2 GB required; it was not retried. The changed Reports tests and the live authorization journey passed, but the full suite is not claimed. Changes remain uncommitted.

## Data-aware filters — B-252

Review Name, First day, Time with the company, and company date and tag fields on Reports. Names search people and distinguish duplicates; dates use a calendar range; tenure uses a numeric range. Saved person filters respect the viewer's current reach.

Checks: CoreHR full suite 450/0/0 before the final label-retention refinement; focused duplicate-name and sharing tests 2/0/0 and final label-retention test 1/0/0. Core frontend 174/0, shared filter tests 6/0, core type check and core/shared lint passed (existing Brand warnings); viewer journeys 5/0/0 and 4/0/0. The earlier targeted backend attempt was memory-refused and not retried. Live date, tenure and person filters were checked. Changes remain uncommitted.

## Report table cleanup — B-256

Review the matrix beneath the chart, particularly Time with the company and a single-date report. Years are labeled once, numbers stay on one line, row colors match the chart, and Change is omitted for a single period. Longer matrices scroll inside their frame. Reports tests 11/0, core type check passed, core lint passed with existing Brand warnings. Live table inspected through the shell.

## Chart interpretation overhaul — B-271

Review Jobs on one date (ranked bars) and over time (overall line and up to four selected groups); Joiners and leavers (separate period bars); Turnover (percentage and unavailable gaps); and Open roles (today only). All groups remain in the table and exports.

Evidence: report backend 15 passed, 0 failed, 0 skipped; full CoreHR 450 passed, 1 failed, 0 skipped (company import scale, B-272; runner omitted reason). Report frontend 19 passed; core type-check and lint passed with existing Brand warnings. CoreHR restarted and live Open roles and Turnover requests returned 200.
