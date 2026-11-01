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
