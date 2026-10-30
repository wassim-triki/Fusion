# Fusion HR Platform — Project Memory

## Project & environment
- [Project overview](project-overview.md) — EY Tunisia HRIS; user owns Core HR + Performance; colleagues own Training/Onboarding & Interview/Recruitment; ports, launch.
- [Local dev auth](local-dev-auth.md) — platform admin `admin@ey-hr.com` (password in data/README.md) via shell :3000; ASK for tenant credentials.
- [Dont reset demo passwords](dont-reset-demo-passwords.md) — never rewrite identity password hashes; try known pw, then ask.
- [OpenSpec CLI](openspec-cli.md) — 1.14.2 via pnpm global (Git Bash needs pnpm dir on PATH); openspec/ gitignored; main specs strict-valid (gate archives).
- [fusion-dev skill](fusion-dev-skill.md) — stack, backend tests (relational + no lock), read-only SQL, API helper; replaces dev-stack.ps1.
- [Next dev/build output split](next-dev-build-output-split.md) — dev → `.next-dev`, build → `.next`; fixes "CSS bugged" dev corruption.
- [Machine memory & checks](machine-memory-checks.md) — 13.9 GB RAM; checks one package at a time, vitest --maxWorkers=2; free memory yourself (stop the frontend for backend stretches).
- [Rendered verification via Playwright](rendered-verification-playwright.md) — only when the user asks; repo Playwright, hydration-tolerant sign-in.
- [Dark, 1440×900 only](ds-dark-only-verification.md) — rendered QA and live screenshots: dark mode, one laptop size; no narrow/mobile/huge passes.
- [Presentation diagrams](presentation-diagrams.md) — `.local-docs/diagrams/`, Mermaid + PlantUML use-case, `-v0` versioning.
- [Audit/history deferred](audit-history-deferred.md) — change-history UI deferred to a unified Perf+Core audit integration.

- [Cloud sessions, fallback](cloud-sessions-partial.md) — local is normal; cloud occasional (B-158); home repo is the fork `wassim-triki/Fusion` (`origin`), org repo read-only `upstream`.

## Design system & doctrine
- [Radius role system](radius-role-system.md) — radii are roles (squircle tier surface 28/control 18/menu/inset/nested/detail/full), ChatGPT-fitted, lint-guarded.
- [Surface tone ladder](surface-tone-ladder.md) — containers lift per level: canvas → `bg-section` → `bg-card` → `bg-inlay` (overlays `bg-popover`); no translucent fills at rest; `@repo/eslint-config/design-roles`.
- [Document + sidebar layout](layout-document-sidebar.md) — frame objects not columns; unframed sticky sidebar; no height-matching/filler; actions in header; Plan pages done, sweep pending.
- [Friendly, not enterprise](design-friendly-not-enterprise.md) — BambooHR-like warmth, alive, self-explanatory; pre-October designs aren't references; read `plans/B-164-design-direction.md` first; style frame before big generations.
- [Person pages: lively, not document](person-pages-lively-not-document.md) — band grammar (big photo, glance row, tabs in band, left rail) accepted at B-166 3a and carried to Home; document layout reads newspaper-like.
- [Layout from first principles](layout-from-first-principles.md) — sidebar isn't mandatory; pick the layout that conveys the screen's job (single column, full width, new).
- [Data table kit](data-table-kit.md) — `@repo/ds/data-table` on TanStack v9: useDataTable + DataTable/Search/Views/FacetFilter/Pagination; adoption follow-ups.
- [Icon set: Hugeicons](icon-set-hugeicons.md) — Performance + Platform icons via `src/lib/icons.tsx` adapters (lint-guarded); core/shell/DS chrome still Lucide.
- [No side-stripe accents](no-side-stripe-accents.md) — coloured left-border status edges read as vibecoded to the user (B-083).
- [Refine the liked version, don't redraw](vibecode-tells-tinted-hero-cards.md) — B-166 Home went downhill through 4 redraws; "could be nicer" = polish; steppers and tinted hero cards read vibe-coded.
- [Beyond primitives](bespoke-ui-beyond-primitives.md) — crafted UI for specific moments, shadcn-based libraries (ReUI) allowed; front pages: visual design and wow first, offer variants.
- [Anti-vibecode design governance](design-governance-antivibecode.md) — DESIGN.md §33 tells→rules + §34 test; motion/elevation tokens.
- [DS preset provenance](ds-preset-provenance.md) — `@repo/ds` = shadcn preset b6GMQMg3l (zinc + yellow + amber); 5 deliberate overrides.
- [No useEffectEvent under Next 15.5](next-bundled-react-no-useeffectevent.md) — Next's bundled React lacks it; type-check passes, page crashes; use a ref.
- [DS Spinner animation](ds-spinner-animation.md) — custom keyframes tree-shaken in TW4 prod; use built-in `animate-spin`.
- [@repo/ui consolidation](repo-ui-consolidation.md) — owned apps moved to `@repo/ds`; interns' modules still on `@repo/ui`.
- [Loading architecture](loading-architecture.md) — frame always renders; loading only in content area; no shell gates.
- [Roles model](roles-model.md) — B-177: areas over access profiles, holders by rule recomputed from Core HR, chosen = user ids, Jobs/Personal linked until B-214.
- [Permission-gate: hide, don't deny](permission-gate-hide-not-deny.md) — hide inaccessible nav/actions; gate on operational access.

## Core HR / Platform work
- [Tenant record redesign](tenant-record-redesign.md) — `/platform/tenants/{id}` 4 tabs all built (B-120) + tenant archival (B-099).
- [Auth/invite surface redesign](auth-invite-surface-redesign.md) — forced-dark sign-in + invite acceptance on DS.
- [Invite surfaces unified](invite-surfaces-unified.md) — workforce invite matches shell activation via shared `@repo/ds/shell` parts.
- [Administrators page redesign](administrators-page-redesign.md) — `/core/access` tabbed master-detail + provenance + removed admins.
- [Worker profile consolidation](worker-profile-consolidation.md) — one `WorkerProfile` behind `/core/profile` + `/core/people/{id}`.
- [Workforce foundation hardening](workforce-foundation-hardening.md) — OpenSpec Employee→Employment→WorkAssignment→Manager; resume `/opsx:apply`.
- [Workforce People Establishment Slice 1](workforce-people-establishment-slice1.md) — done, archived, committed on `refactor/temp-branch`.
- [People Experience Reengineering](people-experience-reengineering.md) — `/core/people` rebuilt on the temporal domain.
- [Temporal Workforce Maintenance](temporal-workforce-maintenance.md) — as-of profile, timeline, change work/manager/end employment.
- [Workforce Access Activation](workforce-access-activation.md) — archived; membership-scoped binding, cohort activation; frozen.
- [Shell/auth/MFE runtime stabilization](stabilize-shell-auth-mfe-runtime-archived.md) — archived + committed; fail-closed frame, api retry, `/api` proxy.
- [F4A org-import AI UX](f4a-org-import-ai-ux.md) — interpretation phase model; Groq via CoreHR env var.
- [Org Chart interaction polish](org-chart-interaction-polish.md) — reveal halo, anchor-stable expand/collapse, dark React Flow controls.
- [Org import stage architecture](org-import-stage-architecture.md) — Upload→Match→Review; stage from product readiness.
- [Org import semantic assistance](org-import-semantic-assistance.md) — implicit AI matching at upload, auto-apply + abstain.
- [Org import Review Phase 1](org-import-review-phase1.md) — read-only Review, bounded resolutions, fingerprinted publish.
- [Import on-ramp unified](import-onramp-unified.md) — shared `features/data-import/` entry for org + workforce imports.
- [Workforce Import establishment](workforce-import-establishment-proposed.md) — archived; create-only XLSX/CSV establishment.
- [Workforce Import demo-readiness pass](workforce-import-demo-readiness-pass.md) — 7 UI fixes; demo CSV + tenant10 reset recipe.
- [Workforce Import experience audit](workforce-import-experience-audit.md) — 10 ranked findings (2026-08-27).
- [People org chart](people-org-chart-proposal.md) — B-094 card design C; sessions A–C committed by 2026-10-28 (C = open roles B-128), In review (own transform stage, not React Flow).
- [Record validation attributes](aspnet-record-validation-attributes.md) — `[property: MaxLength]` on a request record 500s every call; use parameter targets; prove endpoints with a journey.
- [People changes redesign](people-changes-redesign.md) — B-139 accepted 2026-10-27 (change records + one panel); manager lookups key on employee, not assignment.
- [Workforce import platform reconciliation](workforce-import-platform-reconciliation.md) — approved: workforce onto the org import platform.

## Performance
- [Perf target-state change](perf-target-state-change.md) — archived 2026-10-15; main specs = as-built baseline, not authority for reworked areas.
- [Perf first-principles rework](perf-first-principles-rework.md) — B-065 with Claude: whole module rebuilt, integrated, demo-ready; agent owns domain/contracts/surfaces, user agrees add-ons/wow; settings last.
- [Perf slice 2a plan pages](perf-slice-2a-plan-pages.md) — archived+committed 2026-10-16: check-in status, change requests, development, PlanRail; shapes later slices reuse.
- [Perf slice 2b AI + alignment](perf-slice-2b-ai-alignment.md) — accepted, archived, committed 2026-10-17 (incl. B-081–B-084): SharedKernel AI transport/gate, coach, map; Groq strict-schema compile + dagre label gotchas.
- [Perf slice 3 conversations](perf-slice-3-conversations.md) — accepted, archived, committed 2026-10-19: 1:1s, feedback, requests, praise; B-087 redesign rebuilt; @source gotcha, formatDay.
- [Perf slice 5 calibration](perf-slice-5-calibration.md) — accepted, archived, committed 2026-10-20; archive EBUSY gotcha; Carthage rebuilt with a calibrated round; Sheet width + averages guard gotchas.
- [Perf slice 6 overview/team/insights](perf-slice-6-overview-team-insights.md) — accepted, archived 2026-10-22, committed 2026-10-22 with B-078; one phase rule (`PhaseAsync`), DataTable `rowGroup`, strict-spec gotcha.
- [Slice close settles everything](slice-close-settles-everything.md): check each B-070 slice against the accepted B-069 canvas, list parity, settle open questions before closing.
- [Canvas first for taste rework](canvas-first-for-taste-rework.md) — rejected-on-taste UI: HTML canvas per state, approval, then code (B-087 approved).
- [Perf design reference surfaces](perf-design-reference-surfaces.md) — design from rendered My Plan/drawer screenshots; extend approved surfaces; no bland row-list mockups.
- [Perf Cycle & Goals proposal](perf-cycle-goals-proposed.md) — earlier OpenSpec change (4 chunks); history behind the target-state change.
- [Chunk A](perf-cycle-goals-chunk-a.md) · [Chunks B/C/D](perf-cycle-goals-chunks-bcd.md) — setup→activation; goals/plans/progress; tenant10 recipes.
- [Perf frontend re-engineering pass](perf-frontend-reengineering-pass.md) — A–D coherence pass (IA, headers, composers).
- [Perf org-objective publication](perf-org-objective-publication.md) — Draft→Published by scope owner (approval superseded).
- [Perf org-objective scope authority](perf-org-objective-scope-authority.md) — `performance.objective.org.manage`, coarse `@Tenant` scope.
- [Performance IA: Overview + objective record](performance-ia-overview-record.md) — Org Goals out of sidebar, cycle-aware `?cycle=&objective=` record, ObjectiveAccess policy, compositional Overview.
- [Perf Org Goals scoped planning](perf-org-goals-scoped-planning.md) — `/goals` workspace internals (now contextual "Organization direction").
- [Perf org composer modal](perf-org-composer-modal.md) — org objective composer is a modal; shared `MeasurementEditor`.
- [Perf cycle-setup refactor](perf-cycle-setup-refactor.md) — guided nested-route flow; QA tenant Solara (`qa-admin@fusion.test`).
- [Perf cycle-setup Population step](perf-cycle-setup-population-step.md) — Step 2 rebuilt + 4 brownfield fixes.
- [Perf cycle-setup Review redesign](perf-cycle-setup-review-redesign.md) — Step 3 confirmation-and-launch surface.
- [Perf My Plan populated Draft](perf-my-plan-populated-draft.md) — plan-object workspace; Nour asteria-demo Draft seeded.
- [Perf My Plan execution surface](perf-my-plan-execution.md) — approved plan → progress rows + rail; colour rule.
- [Perf reviewer Plan surface](perf-reviewer-plan-surface.md) — `/team/[planId]` reviewer view (Hana).
- [Perf Team "Your People" roster](perf-team-your-people.md) — `plans/roster` endpoint + grid table; Hana demo seed.
- [Evaluation execution overhaul](performance-evaluation-execution-overhaul.md) — shipped as PR #517.
- [Performance audit + remediation](performance-audit-remediation-proposed.md) — 32 findings → OpenSpec, not implemented.

## User preferences
- [Engineering-first agent workflow](engineering-first-agent-workflow.md) — features over process; rendered QA on request; `.local-docs/agents/` STATE/BACKLOG/LOG; stock skills untouched.
- [Review gate](finished-is-not-accepted.md) — only taste work goes In review; evidence-settled work closes ○; verdict read from conversation; no Done lane.
- [Agent-run board](agent-run-board.md) — agents run `.local-docs/agents` autonomously ("Jarvis"); user rarely touches it; AGENTS.md ~70 lines.
- [STATE for every task](state-for-every-task.md) — set Active work before the first edit of any task, audits included; update as you go.
- [Agent commits everything](agent-commits-everything.md) — the user never commits; commit finished work yourself (applies too), logical commits, then hand over the next session's prompt; push/PR stay the user's.
- [Minimize ETA, no fluff](minimize-eta-no-fluff.md) — long applies: shortest path, checks in background, few final screenshots; ask before committing when the user steers the finish.
- [i18n speed mode](i18n-speed-mode.md) — after B-118: FR+AR just working, few demo screens, no polish; B-119 then B-115 lean.
- [Name items, not just IDs](name-items-not-just-ids.md) — in replies say what B-NNN / a change is in plain words; bare IDs lose the user.
- [Name people with their roles](name-people-with-roles.md) — "Amira Khelifi, the administrator", never a bare demo name; Carthage cast listed.
- [Commit hook + message shape](commit-hook-and-message-shape.md) — pre-commit = full Frontend lint+type-check (minutes, background it); blank line after the subject.
- [Prettier reflows whole files](prettier-reflows-whole-files.md) — `.prettierrc` is 80 cols, code is ~120+; prettier only new files.
- [No cosmetic history rewrites](no-cosmetic-history-rewrites.md) — leave commits as they are unless it matters; don't raise cosmetic slips.
- [Fresh session for applies](fresh-session-for-applies.md) — every apply/coding task starts in a new session; write a cold-pickup recipe into STATE first.
- [Build speed mode](build-speed-mode.md) — scoped tests while building, full checks once, one commit per session, chunk-sized sessions; never cut authz/isolation tests (AGENTS.md › Build speed).
- [Colleague modules only must not break](colleague-modules-only-must-not-break.md) — don't coordinate with or wait on Learning/Recruitment/Interview/Onboarding; just keep them working; since 2026-10-30 (internship over, fork) product plans may hide or replace them.
- Deviate from issue wording when the architecture suggests a better fit.
- [Rewrites acceptable](rewrites-acceptable.md) — don't bias toward refactor-in-place.
- [Port accepted drawings closely](port-accepted-drawings-closely.md) — build to the explorer's specs (spacing, chips, hues, borderless cards); user reviews side by side (B-177 round 1).
- [Reuse only if it fits](reuse-only-if-it-fits.md) — never keep a UI pattern because it exists; judge it against the target design, redo or board it (B-175 tabs, hire form).
- [UI: no explanatory text](ui-no-explanatory-text.md) — carry state with structure, never caption sentences.
- [Polish includes UI/UX + refactor](polish-includes-uiux-and-refactor.md) — polish requests expect audit-then-fix, not wording.
- [Prefers minimal-overhead fix](prefers-minimal-overhead-fix.md) — smallest root-cause fix; hardening as a footnote.
- [No reduced-motion gating](no-reduced-motion-gating.md) — plain animate-*, never motion-safe unless asked.
- [No disuse cleanup on thin window](no-disuse-cleanup-thin-window.md) — don't disable tools from low usage over short windows.
- [Explorers show only new screens](explorers-show-only-new-screens.md) — accepted screens stay in the decisions file, not redrawn; new account = new artifact link.
- [Decide yourself, show an explorer](decide-surface-architecture-yourself.md) — product/architecture calls are mine from research + first principles; ask only on taste; present as an interactive artifact.
- [Artifact db snapshots are frozen](artifact-db-snapshots-frozen.md) — clone `snap.data()` before using it as page state, or clicks silently do nothing.
- [Scope with depth ladders](scope-with-depth-ladders.md) — big reworks: derive intent yourself, open long list, a 0–3 depth ladder per feature the user picks; no closed research spec.
- [Brain dumps are examples](brain-dumps-are-examples.md) — named features/exclusions are signals, not rules; contextual questions draw out their thinking; keep process to yourself.
- [Graduation demo and report](graduation-demo-and-report.md) — jury audience, but build a real self-explanatory HRIS, no demo-story dumbing; time never constrains scope; report studies existing solutions → mark parity / improvement / new.
- [Architecture-durable planning](architecture-durable-planning.md) — cycle-aware identity, one domain authz policy, capability composition not personas, no dubious aggregates.

## Working notes (tracked since B-159, 2026-10-29)
- `.local-docs/agents/` (AGENTS.md, STATE, BACKLOG, LOG, plans, data/, git-conventions, this memory/) is tracked in the public repo; `archive/`, screen images, `data/*.local.json` and `.work/` stay local. The Claude memory folder is a junction to `memory/` here. No passwords in any of it: `FUSION_LOCAL_PASSWORD` (accounts) and `FUSION_PG_PASSWORD` (Postgres) are Windows user variables. Older notes are zipped in `archive/old-notes-2026-10.zip`; paths to `.local-docs/specs|core|screenshots` in older memories are gone.
