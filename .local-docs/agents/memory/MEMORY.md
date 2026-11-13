# Fusion HR Platform — Project Memory

## Project & environment
- [Project overview](project-overview.md) — EY Tunisia HRIS; user owns Core HR + Performance; colleagues own the other modules.
- [Local dev auth](local-dev-auth.md) — platform admin `admin@ey-hr.com` via shell :3000; ASK for tenant credentials.
- [Dont reset demo passwords](dont-reset-demo-passwords.md) — never rewrite identity hashes; try the known password, then ask.
- [OpenSpec CLI](openspec-cli.md) — 1.14.2 via pnpm global; `openspec/` gitignored; main specs strict-valid.
- [fusion-dev skill](fusion-dev-skill.md) — stack, backend tests, read-only SQL, API helper.
- [EF migration while running](ef-migration-while-running.md) — `UseArtifactsOutput`/`ArtifactsPath` + restore, then `dotnet ef migrations add` (B-202).
- [Next dev/build output split](next-dev-build-output-split.md) — dev → `.next-dev`, build → `.next`.
- [Machine memory & checks](machine-memory-checks.md) — 13.9 GB RAM; one package at a time, vitest `--maxWorkers=2`; free memory yourself.
- [Rendered verification via Playwright](rendered-verification-playwright.md) — only on request; repo Playwright, hydration-tolerant sign-in.
- [No screens for small changes](no-screens-for-small-changes.md) — minor fixes: tests + commit.
- [Dark, 1440×900 only](ds-dark-only-verification.md) — rendered QA and screenshots: dark, one laptop size.
- [Presentation diagrams](presentation-diagrams.md) — `.local-docs/diagrams/`, Mermaid + PlantUML, `-v0` versioning.
- [Audit/history deferred](audit-history-deferred.md) — change-history UI waits for a unified Perf+Core audit.
- [Artifacts: one account](artifacts-one-account.md) — on "not found" ask for `/login`; snapshot answers to `plans/*.answers.json`.
- [Cloud sessions, fallback](cloud-sessions-partial.md) — local is normal (B-158); fork `wassim-triki/Fusion` is `origin`, org repo read-only `upstream`.

## Design system & doctrine
- [Radius role system](radius-role-system.md) — radii are roles (surface 28 / control 18 / …), lint-guarded.
- [Surface tone ladder](surface-tone-ladder.md) — canvas → `bg-section` → `bg-card` → `bg-inlay`; no translucent fills at rest.
- [Document + sidebar layout](layout-document-sidebar.md) — frame objects not columns; unframed sticky sidebar; actions in header.
- [Friendly, not enterprise](design-friendly-not-enterprise.md) — BambooHR-like warmth; read `design/direction.md` first; style frame before big generations.
- [Person pages: lively](person-pages-lively-not-document.md) — band grammar (big photo, glance row, tabs in band, left rail), B-166.
- [Layout from first principles](layout-from-first-principles.md) — pick the layout for the screen's job; a sidebar isn't mandatory.
- [Data table kit](data-table-kit.md) — `@repo/ds/data-table` on TanStack v9.
- [Icon set: Hugeicons](icon-set-hugeicons.md) — via `src/lib/icons.tsx` adapters (lint-guarded).
- [No side-stripe accents](no-side-stripe-accents.md) — coloured left-border edges read vibecoded (B-083).
- [Refine the liked version](vibecode-tells-tinted-hero-cards.md) — "could be nicer" = polish, not redraw; steppers and tinted hero cards read vibe-coded.
- [Beyond primitives](bespoke-ui-beyond-primitives.md) — crafted UI for specific moments; front pages: wow first, offer variants.
- [Anti-vibecode governance](design-governance-antivibecode.md) — DESIGN.md §33 tells→rules, §34 test.
- [DS preset provenance](ds-preset-provenance.md) — shadcn preset b6GMQMg3l; 5 deliberate overrides.
- [No useEffectEvent under Next 15.5](next-bundled-react-no-useeffectevent.md) — type-check passes, page crashes; use a ref.
- [replaceState(null) for Next](next-replacestate-null-state.md) — a state carrying `__NA` skips the useSearchParams sync (B-419).
- [DS Spinner animation](ds-spinner-animation.md) — custom keyframes tree-shaken in TW4 prod; use `animate-spin`.
- [@repo/ui consolidation](repo-ui-consolidation.md) — our apps on `@repo/ds`; interns' modules still on `@repo/ui`.
- [Loading architecture](loading-architecture.md) — B-280 pending contract and stable Home frame; hydration guards kept.
- [Roles model](roles-model.md) — B-177: areas over profiles, holders by rule from Core HR, chosen = user ids.
- [Section titles inside sections](section-titles-inside-sections.md) — title + actions in the container; fields darker than surface; DS pickers only.
- [Failure pages](page-failure-family.md) — `PageFailure` (`@repo/auth`) picks, `PageState` (DS) draws; no hooks in `page-states.tsx`.
- [Permission-gate: hide, don't deny](permission-gate-hide-not-deny.md) — hide inaccessible nav and actions.

## Core HR / Platform work
- [Reports engine](reports-engine.md) — B-189/B-190: one engine for Reports, exports and the front page; dated snapshots, viewer field policy.
- [Tenant record redesign](tenant-record-redesign.md) — `/platform/tenants/{id}` 4 tabs (B-120) + archival (B-099).
- [Home company and manager contracts](home-company-manager.md) — B-247/B-248: work week, self-only manager, first-week card.
- [Workforce invitation lifecycle](workforce-invitation-lifecycle.md) — B-235: lookup, row locking, credential rotation, cache refresh.
- [First person's imported start](first-person-import-start.md) — B-246: activation provenance, earlier-date offer.
- [People org chart](people-org-chart-proposal.md) — B-094 card design C, open roles B-128; own transform stage, not React Flow.
- [People changes redesign](people-changes-redesign.md) — B-139: change records + one panel; manager lookups key on employee.
- [Change requests dry run](change-requests-dry-run.md) — B-179: staged in a rolled-back tx; profile hooks above early returns.
- [Record validation attributes](aspnet-record-validation-attributes.md) — `[property: MaxLength]` on a request record 500s; use parameter targets.
- [Dictionary query binding](aspnet-dictionary-query-binding.md) — `[FromQuery] Dictionary` swallows every key; parse `fields[...]` by hand.
- Auth and invites (history): [surfaces](auth-invite-surface-redesign.md) · [unified](invite-surfaces-unified.md) · [administrators page](administrators-page-redesign.md) · [access activation](workforce-access-activation.md) · [shell/auth runtime](stabilize-shell-auth-mfe-runtime-archived.md)
- Workforce domain (history): [profile](worker-profile-consolidation.md) · [foundation](workforce-foundation-hardening.md) · [establishment 1](workforce-people-establishment-slice1.md) · [People rebuilt](people-experience-reengineering.md) · [temporal maintenance](temporal-workforce-maintenance.md)
- Imports (history): [AI UX](f4a-org-import-ai-ux.md) · [stages](org-import-stage-architecture.md) · [semantic help](org-import-semantic-assistance.md) · [review 1](org-import-review-phase1.md) · [on-ramp](import-onramp-unified.md) · [workforce](workforce-import-establishment-proposed.md) · [demo pass](workforce-import-demo-readiness-pass.md) · [audit](workforce-import-experience-audit.md) · [reconciliation](workforce-import-platform-reconciliation.md) · [org chart polish](org-chart-interaction-polish.md)

## Performance
- [First-principles rework](perf-first-principles-rework.md) — B-065: module rebuilt; agent owns domain/contracts/surfaces, user agrees add-ons and wow.
- [Target-state change](perf-target-state-change.md) — main specs = as-built baseline, not authority for reworked areas.
- [Slice close settles everything](slice-close-settles-everything.md) — check each slice against its accepted canvas; settle open questions before closing.
- [Canvas first for taste rework](canvas-first-for-taste-rework.md) — rejected-on-taste UI: HTML canvas per state, approval, then code.
- [Design reference surfaces](perf-design-reference-surfaces.md) — extend approved surfaces; no bland row-list mockups.
- October slices (gotchas inside): [2a plan pages](perf-slice-2a-plan-pages.md) · [2b AI + alignment](perf-slice-2b-ai-alignment.md) (Groq strict schema) · [3 conversations](perf-slice-3-conversations.md) · [5 calibration](perf-slice-5-calibration.md) · [6 overview/team](perf-slice-6-overview-team-insights.md)
- Before the rework (history, replaced by B-390): [cycle & goals](perf-cycle-goals-proposed.md) · [chunk A](perf-cycle-goals-chunk-a.md) · [B/C/D](perf-cycle-goals-chunks-bcd.md) · [frontend pass](perf-frontend-reengineering-pass.md) · [org-objective publication](perf-org-objective-publication.md) · [scope authority](perf-org-objective-scope-authority.md) · [IA](performance-ia-overview-record.md) · [org goals](perf-org-goals-scoped-planning.md) · [composer](perf-org-composer-modal.md) · [setup](perf-cycle-setup-refactor.md) · [population](perf-cycle-setup-population-step.md) · [setup review](perf-cycle-setup-review-redesign.md) · [My Plan draft](perf-my-plan-populated-draft.md) · [execution](perf-my-plan-execution.md) · [reviewer plan](perf-reviewer-plan-surface.md) · [roster](perf-team-your-people.md) · [evaluation](performance-evaluation-execution-overhaul.md) · [audit](performance-audit-remediation-proposed.md)

## User preferences
- [Engineering-first workflow](engineering-first-agent-workflow.md) — features over process; rendered QA on request.
- [Agent-run board](agent-run-board.md) — agents run `.local-docs/agents`; the user rarely touches it.
- [STATE for every task](state-for-every-task.md) — set Active work before the first edit, audits included.
- [`next` takes the top row](next-takes-top-row.md) — "next" runs STATE's top queue row end to end and commits.
- [Fresh session for applies](fresh-session-for-applies.md) — each coding task in a new session; cold-pickup recipe in STATE first.
- [Build speed mode](build-speed-mode.md) — one slice = one session, one agent, one commit; only proving tests; never cut authz/isolation tests.
- [Minimize ETA, no fluff](minimize-eta-no-fluff.md) — shortest path, checks in background, few screenshots.
- [Agent commits everything](agent-commits-everything.md) — commit finished work yourself, then hand over the next prompt; push/PR stay the user's.
- [Commit hook + message shape](commit-hook-and-message-shape.md) — hook = lint + type-check of our apps (minutes, background it); blank line after the subject.
- [Prettier reflows whole files](prettier-reflows-whole-files.md) — prettier only new files.
- [No cosmetic history rewrites](no-cosmetic-history-rewrites.md) — leave commits as they are.
- [Review gate](finished-is-not-accepted.md) — only taste work goes In review; the rest closes ○; verdict read from conversation.
- [Review notes: board, fix later](review-notes-board-later.md) — review notes become Ready items; fix only when told.
- [Review handoff](review-handoff-screens-or-credentials.md) — screenshots inline, or email + password with every localhost link.
- [Short replies, keep the rest](short-replies-keep-the-rest.md) — reply with one concrete next thing.
- [Name items, not just IDs](name-items-not-just-ids.md) — say what B-NNN is in plain words.
- [Name people with their roles](name-people-with-roles.md) — "Amira Khelifi, the administrator".
- [Walkthrough: one step at a time](walkthrough-one-step-at-a-time.md) — one step per message, stable numbering.
- [Board categories](board-essentials-definition.md) — Big features · Polish · Before hosting · Cleanup and tooling · Parked.
- [Colleague modules must not break](colleague-modules-only-must-not-break.md) — don't wait on them; product plans may hide or replace them.
- [Rewrites acceptable](rewrites-acceptable.md) — no bias toward refactor-in-place; deviate from issue wording when the architecture fits better.
- [Prefers minimal-overhead fix](prefers-minimal-overhead-fix.md) — smallest root-cause fix; hardening as a footnote.
- [Polish includes UI/UX + refactor](polish-includes-uiux-and-refactor.md) — audit-then-fix, not wording.
- [Architecture-durable planning](architecture-durable-planning.md) — cycle-aware identity, one authz policy, capabilities not personas.
- [Decide yourself, show an explorer](decide-surface-architecture-yourself.md) — product/architecture calls are mine; ask only on taste.
- [Scope with depth ladders](scope-with-depth-ladders.md) — big reworks: open long list, a 0–3 depth ladder per feature.
- [UI decisions: shown, per situation](ui-decisions-shown-per-situation.md) — draw the variants, labels only; one chapter per session.
- [Explorers show only new screens](explorers-show-only-new-screens.md) — accepted screens stay in the decisions file.
- [Artifact db snapshots are frozen](artifact-db-snapshots-frozen.md) — clone `snap.data()` before using it as state.
- [Port accepted drawings closely](port-accepted-drawings-closely.md) — build to the explorer's specs; reviewed side by side.
- [Redesigns: bold, not tweaks](redesigns-bold-not-tweaks.md) — change structure from the surface's job.
- [Reuse only if it fits](reuse-only-if-it-fits.md) — judge an existing pattern against the target design.
- [Brain dumps are examples](brain-dumps-are-examples.md) — named features are signals, not rules.
- [Brain dumps are surface overhauls](brain-dumps-are-surface-overhauls.md) — screen complaints = rethink the surface; one item per surface.
- [UI: no explanatory text](ui-no-explanatory-text.md) — carry state with structure, not captions.
- [Actions say what happens](actions-say-what-happens.md) — a button tells its outcome before the click and confirms after.
- [Fusion does the bookkeeping](fusion-does-the-bookkeeping.md) — nothing typed or ticked that Fusion can compute (D-35, D-40).
- [No reduced-motion gating](no-reduced-motion-gating.md) — plain `animate-*`.
- [Graduation demo and report](graduation-demo-and-report.md) — jury audience, real HRIS; report marks parity / improvement / new.
- [i18n speed mode](i18n-speed-mode.md) — FR+AR just working, no polish.
- [No disuse cleanup on thin window](no-disuse-cleanup-thin-window.md) — don't disable tools from low usage over short windows.

## Working notes
- `.local-docs/agents/` is tracked in the public repo (`archive/`, screens, `data/*.local.json`, `.work/` stay local); the Claude memory folder is a junction to `memory/`. No passwords: `FUSION_LOCAL_PASSWORD` and `FUSION_PG_PASSWORD` are Windows user variables. Paths to `.local-docs/specs|core|screenshots` in older memories are gone.
