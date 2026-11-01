# Reports engine (B-189)

`CoreHR/Features/Reports/ReportEngine` serves standard reports, the builder and both exports; reuse it for B-190's front page. `ReportViewer.From` takes authority only from claims. The existing `core.overview.view` read grant now permits Tenant or DirectReports (keeps existing roles working); `core.reports.build` controls saved-definition writes. Reports area's See/Build × team/everyone maps to those grants.

Current manager branch is resolved by `ChangeSupport.BranchAsync` before loading report people or aggregating. That same allowed branch applies to past dates. Dated employment, assignments and unit states supply historical snapshots; custom Fields values are current, since the Fields feature stores current values. Open roles follow Organization's current-plan/from-today rule.

Never bypass `FieldsAsync`'s whitelist, including for grouping and filters. A saved definition may itself hold sensitive filter literals: lists return summaries; opening a definition checks visibility before returning it. Saved reports carry owner and role shares, never authority or cached results. Role audience is read live over the signed Identity channel; sharing does not grant Reports access.

`data/journey-b189-reports.cjs` sets Managers to See their team and keeps the shared Engineering by place demo in Carthage.
