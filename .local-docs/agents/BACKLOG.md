# BACKLOG — the board

Open work only. Agents keep it current from the conversation; closed items leave the board and live in `LOG.md`.

| Lane | Meaning |
| --- | --- |
| In progress | An agent is on it (mirrors `STATE.md` Active work). |
| In review | Done, but only a human eye can tell if it's right. Says what to look at. |
| Ready | Agreed and actionable, in priority order. |
| Needs discussion | Not actionable until talked through. |

**Items**

```md
- [ ] **B-NNN** One-line outcome · Area · YYYY-MM-DD
      Context, evidence or "Look at: …" on indented lines. Links: [plan](plans/B-NNN-slug.md)
  - [ ] **B-NNN** A concrete piece of the parent
```

- **Hierarchy:** a parent is an outcome the user would recognise; children are its pieces. Two levels by default, three only when it helps. Agents split, merge, reparent, reorder and retitle freely; IDs never change.
- **IDs:** unique, never reused; next is one above the highest ever used (check `LOG.md`). **Next ID: B-288.**
- **Review gate:** only noticeable, judgment-dependent work goes to In review. Evidence-settled work (backend, refactors, config, small or as-asked fixes) closes straight to `LOG.md` with ○.
- **Closing:** user approval in conversation (or a ticked box) closes ✓; a complaint becomes a Ready child and the parent stays In review.

**Workstreams:** only the numbered slices in [B-167](plans/B-167-rebuild.md) are rebuild slices. Follow-ups, product features, maintenance and deferred UI are other work; grouping does not make them extra slices.

| Rebuild slice | Task | Status |
| --- | --- | --- |
| 1–16 | Jobs/places/lists through the Core HR front page | Accepted and closed |
| 17 · B-191 | Single sign-on | Ready; next planned slice |
| 18 · B-192 | Seams and finish | Queued after the preceding slices |

## In progress

- [ ] **B-286** Review and close what Codex left In review, in batches that share a surface: design-first live check against the agreed drawings, fixes in the same pass, one look per batch · All · 2026-11-04
      User 2026-11-04, after the usage-limit break. Items keep their own lanes; this tracks the pass. Plan and progress in STATE.
  - [x] **Batch 1** Core HR front page (B-190 ✓) + B-280 loading in Core, Performance, Platform (accepted). Fixes in 2b5cd9c4.
  - [x] **Front page follow-ups** B-284 (payload 5.5 MB → 120 KB) and B-285 (faces on Next 30 days and open roles) closed ○.
  - [ ] **Batch 2** Home: redesign the company card (B-247) and manager card (B-248), rejected 11-03, then review them with B-280's Home part; commit B-280.
        2026-11-04: B-280 Home loading checked, sidebar module flicker fixed. User picked company C and manager A+B on the [canvas](https://claude.ai/artifact/BvgCaYiseSdKQ31Vzj5bPp); built and committed with B-280. Waiting on one look at Home (B-247, B-248, B-280).
  - [ ] **Batch 3** B-246, the first person's imported start date.

### Rebuild program tracking

These are umbrella outcomes, not additional slices.

- [ ] **B-164** The tenant experience, rebuilt from first principles: from a new tenant administrator's first sign-in to everyday use by every role, design-first, coherent and demo-ready; Core HR reworked deepest, Performance checked at its seams · Core HR, Shell, Performance · 2026-10-30
      User 2026-10-30, before any other task: Core HR was winged without specs and feels dated; clean it up, remove/merge/redesign/re-architect, BambooHR-like, no vibe-code feel, the same way as the Performance rework (research, recommendations, an interactive artifact, taste questions). Platform admin out. Order: thin map → independent target → the audit is the diff, in one explorer → decisions → rebuild → tour. [plan](plans/B-164-tenant-experience-overhaul.md)
  - [ ] **B-110** Tenant configurability as a hero: branding (logo, theme/accent, branded sign-in, own address, email branding) and internal configuration (company defaults and whatever the research puts on the ladder), depth chosen on B-163's scope page · Shell, Platform, Core HR, Identity · 2026-10-24
        User 2026-10-30: "I really wanna establish it as a core wow factor"; EY discussed it a lot but never gave specs or how far to take it. Earlier (2026-10-24) brain dump, ideas not requirements. A tenant's default language meets B-105. Context: B-071 removed the unused brand colour from Core's branding settings; Core's branding settings store a `LogoUrl` that no screen sets or shows; Company settings show name and locale.
  - [ ] **B-167** Rebuild: slices in dependency order, each end to end with screens for the taste check ([decisions](plans/B-164-decisions.md), D-01–D-30; [slices](plans/B-167-rebuild.md)) · 2026-10-30
        Order and per-session effort accepted 2026-10-30 (user asked for the next prompt). B-175 done (✓ 2026-10-30); B-176 done (✓ 2026-10-30); B-177 done (✓ 2026-10-31); B-178 done (✓ 2026-10-31); B-179 done (✓ 2026-10-31); B-180 done (✓ 2026-10-31); B-181 done (✓ 2026-10-31); B-182 done (✓ 2026-10-31); B-183 done (✓ 2026-11-01); B-184 done (✓ 2026-11-01); B-185 done (✓ 2026-11-01); B-186 done (✓ 2026-11-01); B-187 done (✓ 2026-11-01); B-188 done (✓ 2026-11-01); B-189 Reports done (✓ 2026-11-03); B-190 Core HR’s front page done (✓ 2026-11-04).

## In review

### Rebuild slices

None waiting.

### Other reviews

- [ ] **B-280** Consistent loading placeholders across owned MFEs, with Shell Home's frame retained · Shell, Core HR, Performance, Platform · 2026-11-04
      2026-11-04: Core, Performance and Platform loading accepted with batch 1 (user: "looks good enough"); Home part reviewed with batch 2 (B-247/B-248). Batch 1 also fixed the record breadcrumb showing the raw employee key while loading.
      Implemented and verified, including Shell Home. Look at initial entry/refresh on Home, Core People/worker record, Performance 1:1 list/series and Platform Tenants/record: one content-pending shape through access/data loading, stable frame. Canonical static loaders, real hydration hold, no artificial waits or early protected pages. Targeted tests160/0/0; four cold builds with lint/types; production browser41/0/0 plus dev19/0/0; read-only API negatives8/0/0 plus anonymous context401; security-review clear. [Diagnosis, timed before/after evidence, scope and review guide](plans/B-280-loading-investigation.md). Genuine BFCache/actually painted target-route fallback and exhaustive other-route parity unclaimed. Existing photo, stale-hint recovery and early header-read follow-ups queued separately as B-281/B-282/B-283. Committed 2026-11-04 with the Home cards; Home part waits on the same look as B-247/B-248.

- [ ] **B-246** The first person's imported start date: an explicit choice between activation day and the earlier file date · Core HR · 2026-11-04
      In review. Look at the dated choices in Also to check and the corresponding Start date row in Changed; Keep is the default, including Take leans. [Inspection guide and one dark capture](plans/B-246-first-person-start.md). Positive server-side activation provenance/history, publish-time row locks/revalidation, atomic employment/assignment correction and frozen-plan retry. Older unproven records remain ineligible. EN/FR/AR. Final CoreHR 470/0/0, focused 13/0/0, touched frontend 9/0/0, resumed live API 17/0/0, capture 1/0/0; four lint/types and catalogue parity pass. User requested committing on 2026-11-04 while explicitly keeping this In review. Other reviews/deferrals preserved.

- [ ] **B-247** Company work week in Settings › Details and Home’s company card · Core HR, Shell · 2026-11-03
      2026-11-04: redesigned as option C (company and people in one card), committed; look at the Fresh administrator's Home.
      Settings selector accepted and B-278 closed 2026-11-03 (“good, can be closed”). Remaining review is Home’s company card; it was not accepted or changed by the Settings verdict. Look at Home’s label-over-value work-week fact (D-09). Existing settings defaults/versioned saves, company permissions and tenant isolation; EN/FR/AR. [Review guide](plans/B-247-company-work-week.md). Original shared verification with B-248: CoreHR 464/0/0, frontend 42/0/0, API 30/0/0; accepted selector checks in LOG. Implementation committed; review remains open.
- [ ] **B-248** Your manager on a joiner’s Home, from an ordinary employee’s self-only canonical read · Core HR, Shell · 2026-11-03
      2026-11-04: redesigned as A+B (person card + who else reports to the manager), committed; look at Ons Khemiri's Home.
      Remains In review, not accepted. B-278's approved implementation is Settings-only; Home/manager visuals were set aside and remain unchanged. Look at the top-right manager card during the joiner’s first seven calendar days: initials, name and current job (D-12); no manager/loading/failure states covered. [Review guide, fixture sign-in and dark screen](plans/B-248-joiner-manager.md). No management permission needed; other-person/date/tenant selectors cannot redirect it. Security-review: no high-confidence findings. Original shared evidence in LOG. Implementation committed; review remains open.

## Ready

### Rebuild slices

- [ ] **B-191** Single sign-on: Microsoft, Google, a company's own provider, required per domain · Identity, Shell · 2026-10-30
- [ ] **B-192** Seams and finish: colleague modules only when on, their lint and type-check once (the hook skips them since B-234), one vocabulary, replaced surfaces gone, demo presets for the tour · All · 2026-10-30
      Vocabulary seam from B-190: D-30’s six company departments are the Division-level units above Department A/B; Reports’ existing division field is the top ancestor under the root. Keep the accepted grouping while aligning the words.

### Other work

- [ ] **B-282** Recover sign-in when a stale compatibility hint has no stored session · Shell, shared authentication · 2026-11-04
      B-280's production negatives confirm fail-closed behavior (zero protected page reads or successful protected responses), but `ey_hr_authenticated=true` with no real session redirects an MFE to sign-in, middleware sends sign-in to Home, and Home ends at No workspace is available. Without the hint, sign-in opens normally. Existing middleware/entry behavior, independent of skeleton presentation; remove the stale hint or otherwise recover sign-in without trusting the cookie as authority. Keep separate from B-280; no authentication flow fix attempted here.

- [ ] **B-287** Open roles remember who filled them, so the front page can show "Filled · Ons Khemiri, Monday" as drawn (D-30); today a filled role keeps no link to the hire or date · Core HR · 2026-11-04
      From B-285: the open roles model has Open/OnHold/Filled/Closed only.

- [ ] **B-283** Gate Performance header cycle queries on workspace readiness and route relevance · Performance · 2026-11-04
      B-280's stale-hint production control starts `/api/performance/context` from the unchanged PerformanceCycleContext before redirect; navigation cancels it before a response. Both useCurrentCycle/useWorkspaceContext run before the cycle-free-route return, without auth readiness. Protected 1:1 page never mounts/queries; anonymous context API refuses access. Existing source (last changed c7402cbb), not introduced by B-280; keep frame mounted while disabling unnecessary header reads until permitted and on cycle-free routes. No fix attempted here.

- [ ] **B-281** Diagnose missing Carthage photo responses seen during loading investigation · Core HR, shared navigation · 2026-11-04
      B-280 investigation repeatedly reported five `/api/corehr/employees/people/{id}/photo` 404s across Core and Performance; implementation verification including the employee's cards adds one more (six unique photo paths). Initials render and page data succeeds; no hydration/page errors observed. Not the skeleton-switch cause (the SSR access placeholder predates these requests). Keep separate; no data or photo repair attempted. Exact response paths remain in ignored B-280 evidence.

- [ ] **B-277** Resolve archive collisions for completed review plans · Tooling · 2026-11-03
      Stack startup repeatedly reports `archive/plans/B-189-reports.md exists; left B-189-reports.md in plans/`. Compare and preserve both copies’ information before clearing the completed plan from the active folder.

- [ ] **B-279** Capture and diagnose an intermittent first dated-profile response after historical import · Core HR · 2026-11-04
      During B-246's first live publication, the dated-manager assertion failed; that harness did not retain the response status/body. The immediate direct read was 200 with the correct historical manager, and the resumed journey passed 17/0/0. No cause established. The journey now reports non-200 responses and manager mismatches explicitly and reuses fixtures with --resume. Reproduce with response evidence before attributing it to the domain, gateway or environment; remains queued separately from the completed start-date correction.

- [ ] **B-272** Investigate the 2,000-person company import scale test failure · Core HR · 2026-11-02
      Full CoreHR suite during B-271: 450 passed, 1 failed in Scale_two_thousand_people_in_eighty_units (3m50s); test runner omitted failure detail. B-190, 2026-11-03: repeated full relational suites pass 454/0/0, including scale; original failure not reproduced, no import code changed.

- [ ] **B-255** Scale Reports filter values with viewer-scoped server search when company data grows; report runs currently return the complete allowed value set.

- [ ] **B-249** The brand studio's Home preview draws the real Home (day one's guide, the company card) instead of its stand-in (from B-188's notes) · Core HR · 2026-11-01

- [ ] **B-245** The import groups titles into job families when the files have no family column (D-23 widened the AI to it): suggestions marked with the sparkle, each family changeable on the chart's Jobs view · Core HR · 2026-11-01

- [ ] **B-244** `@repo/ds` settings sidebar test fails 3 cases ("Employee fields" link not found, EN and FR); seen 2026-11-01 during B-185, which doesn't touch settings · Shared · 2026-11-01

- [ ] **B-242** Tidy after the Organization refit: drop core's unused `@xyflow/react` dependency (lockfile update) and the now-unused `flattenOrganizationHierarchy` · Core HR · 2026-11-01

- [ ] **B-240** Directory card as drawn (D-28): initials in Fusion's serif on every face, and the card footer's org chart icon matching the drawing's (Hugeicons Hierarchy; Core's chrome is still Lucide, so pick the match or move this icon). Long names already end in an ellipsis · Core HR · 2026-10-31
      User 2026-10-31 (B-182 review, card compared with `plans/B-182-screens/ref-directory-card.png`).

- [ ] **B-236** Platform's tenant list keeps its own CSV export; move it onto the table kit's `DataTableExport` (B-182's one Export) · Platform · 2026-10-31

- [ ] **B-228** Performance's object lists keep their headings on the canvas (My Plan's sections, the review record's sections, Feedback's request lists, the person summary's Performance parts): each is a list of standalone rich cards, so putting the title inside means the objects become rows or inlays in one frame. Recommendation: rows with the rich detail in the drawer, as Needs you does. Left out of B-225's sweep for that reason · Performance · 2026-10-31

- [ ] **B-220** While seeing Fusion as someone, show changes as inert (the drawing's "Propose a change" greyed) instead of letting the server refuse them: today every write is refused server-side (403 "Nothing can be changed while seeing Fusion as someone") and forms show that error · Shell, Core HR, Performance · 2026-10-31
      Found building B-178. A shared "is viewing" flag from `@repo/auth` (`useViewAs`) that action buttons read.

- [ ] **B-221** Administrator invitations issued before B-178 can still be accepted, but nothing lists or revokes them now (the customer-side email invitation retired: only people who already sign in can be made administrators). List them on the Administrators page with Revoke, or expire them · Identity, Core HR · 2026-10-31

- [ ] **B-222** Clean up what the old Administrators workspace left: Core HR's `admins` message namespace, the `/access` route skeletons, suspend/reactivate (still enforced by the two-administrator rule, no screen offers them), and the invite acceptance's Employee/Manager label from `InviteToken.Role` · Core HR, Identity · 2026-10-31

- [ ] **B-211** Search in the top bar, made real: people first, then records and settings, as one place to find anything; a candidate small wow · Shell, Core HR, Performance · 2026-10-30
      User 2026-10-30: "we should even have that search bar like we exactly have it in the artifacts … even if the functionality is not there yet … could be part of a small wow factor … just wire it in." Wired 2026-10-30 under B-176: the field (Ctrl/⌘ K) opens a palette of the places the person can open.

- [ ] **B-203** Brand changes in Change history: a save in Settings › Brand is stored in Identity and isn't in Core HR's change history yet; fold into the unified audit (see the audit-history-deferred note) · Identity, Core HR · 2026-10-30

- [ ] **B-204** Notification emails from Core HR and Performance in the company's brand (name, logo, colour), as invitations are since B-176; the modules don't hold the brand, so Identity serves it to them · Core HR, Performance, Identity · 2026-10-30

- [ ] **B-205** The invitation acceptance and activation pages in the company's brand (the same frame as sign-in); fits B-188's activation redraw · Shell, Core HR · 2026-10-30

- [ ] **B-206** `@repo/auth` `language.test.tsx` "is left alone when the session carries no supported language" fails under jsdom (an emptied `NEXT_LOCALE` cookie stays as ""), seen in B-176, file untouched by it · Frontend · 2026-10-30

- [ ] **B-202** `fusion-dev` script that adds an EF migration without stopping the running service (build to the artifacts path, then `dotnet ef … --no-build` against it); B-175 had to stop CoreHR for it · Tooling · 2026-10-30

- [ ] **B-090** Product tour: an interactive walkthrough that takes a new tenant from the platform admin's invite through its first real use of Fusion · Shell, Core, Performance · 2026-10-20
      User: another wow factor that, done right, also carries a realistic demo from the tenant's point of view, "taking over after the initial platform admin invite". Open: where it starts and ends, who it's for (tenant admin, HR, manager, employee), guided steps vs. checklist vs. contextual hints, and whether it runs on real or demo data. Best after B-089 and the demo seeder, so it walks finished screens.
      User again 2026-10-29: onboard the person in real time, a tutorial that shows them around and guides them to set up their things; would carry the demo too. No details yet, discussion first.
      User 2026-10-30: "i would want a product tour, its a good prio feature". Next up; starts with a decision page (where it starts and ends, who it guides, how it moves through real screens) before any code.
      User 2026-10-30, later: the tour needs cleanly engineered features first, so it follows B-164; its storyline is B-166's journey, and the explorer marks the tour-worthy moments.
      User 2026-10-30, checkpoint 2: consolidate with B-164's setup guide (F1). One guidance system: the setup guide on Home is the tour's administrator track; each step opens the real screen where the tour takes over. B-167 builds the guide for the tour to extend.

- [ ] **B-065** Rebuild Performance from first principles into a complete, integrated, demo-ready module · Performance · 2026-10-15
      2026-10-26: all seven slices (B-070), Settings (B-071) and English/French/Arabic are done and committed. What's left: the user's hand pass (B-104, In review); the polish itself (B-089) is done. Inventory done ([B-067](plans/B-067-performance-inventory.md)); decisions accepted ([B-068](plans/B-068-decisions.md)). With Claude. Research → feature catalogue and decisions → surface architecture and role × state design → contracts → implementation. The agent owns product knowledge, architecture, contracts, implementation and surface design; the user agrees add-ons and wow features from the agent's recommendations. Settings is reworked once, last. See [plan](plans/B-065-performance-first-principles-rework.md).

- [ ] **B-105** Real internationalization: English, French and Arabic fully configured across our modules (Arabic means right-to-left layouts too); screens are done in all three, only server text (B-116) is left and parked · Shell, Core HR, Performance, Platform · 2026-10-23
      From B-071 C-6: the switch lives in Settings > Preferences. 2026-10-24, user: wants EN/FR/AR later, so "remove the switch" is off the table. To discuss: how translations are stored and loaded, dates and numbers per locale, RTL in `@repo/ds`, server text (emails, notifications, errors), and how it meets B-110 (a tenant's default language).
      2026-10-24: agreed to settle the foundation first (translation library and message format; start/end instead of left/right in `@repo/ds` and our apps, lint-guarded) because every new screen adds cost. Decision page delivered: [artifact](https://claude.ai/artifact/R1x8YyFNNTf4qsHVBph1U9) (`plans/B-105-internationalization.html`). User 2026-10-24: language lives on the account (I-3); colleagues' modules only must not crash; we draft translations, no native reviewer; the rest as recommended. Phase 1 proposed as OpenSpec `add-i18n-foundation` (strict-valid, 11 tasks): account language in Identity + `NEXT_LOCALE` from `@repo/auth`, next-intl wired in our four apps via `@repo/i18n` with Preferences translated EN/FR as proof, start/end layout + lint guard, one place for dates and numbers. Preconditions met 2026-10-25 (polish pass and Settings committed, Settings change archived): ready to apply in a fresh session.
      2026-10-25: phase 1 (the groundwork) accepted (user moved on: "Just proceed"), archived as `2026-10-25-add-i18n-foundation`, uncommitted for the user to commit. Phases 2–5 are the children below, in the decision page's order.
      2026-10-25: phase 2 (B-113, the frame in English and French) accepted (user: "proceed"), uncommitted for the user.
      2026-10-26, user: get internationalization done fast and move on. The demo shows a few screens at most; the goal is the feature working in French and Arabic, not perfection. Remaining children run lean: translate what renders, no per-area screens or polish, one French/Arabic test per module.
      For the Arabic phase: the CSS build maps logical insets to left/right through `:lang(ar …)`, so `<html lang>` must be set with `dir`; sheet sides, slide animations and time-axis charts are still physical.

  - [ ] **B-116** Phase 5: server text in the person's language: emails per recipient, notification and error codes rendered on screen, change history as data · Identity, Core HR, Performance · 2026-10-25
        From B-114 D8: AI output (plan coach, review starters, calibration summaries) answers in the person's language.
        2026-10-26, user: skip for now ("skin b116 for now"); French and Arabic screens are done (B-114, B-115 closed). Not next.
      User 2026-10-30: B-116 is low priority for now.

- [ ] **B-210** Sign-in's company column feels empty (logo and name on a wash); give it more, canvas first · Shell · 2026-10-30
      User 2026-10-30 on the Arabic sign-in: "looks clean, still lacking … especially the empty column holding the title of the organization". Revisit later, not urgent (user, same day).

### Other work — follow-ups from earlier rebuild slices

These keep their original scope and connection to B-167/B-192; they are not numbered slices.

- [ ] **B-198** One tab and view-switch pattern across Fusion, matching the target design: every tab strip and view switch today is reused old UI (the Organization lenses are the latest example). Define it once in `@repo/ds` from the accepted grammar (D-01 band tabs, D-17 views), first where a slice draws tabs (B-180's person page or B-183's Organization, whichever comes first), then replace every other use; B-192 checks none is left · All · 2026-10-30
      2026-10-31: defined as `LinkTabs` in `@repo/ds/shell` (active = company color, outline + subtle fill) and used on the person page (B-180); every other tab strip and view switch still to move.

- [ ] **B-212** Reach "their unit" for roles (D-25 draws it): Core HR's record reads and Performance resolve the viewer's unit and the units under it, then the Jobs, Personal and Plans areas offer it. Not offered in B-177 because nothing enforces it yet (`performance.cycle.view@OrgUnit` is unseeded and treated as a team) · Core HR, Performance, Identity · 2026-10-30
  User 2026-10-31 (B-179 screen 11 vs the drawing): the band's glance row gets manager, team, time with the company and location even though the left rail repeats them (keep the rail); a ⋯ menu at the band's top right like the drawing (empty if nothing fits); sections stacked one under another as drawn, not the newspaper grid, titles inside their sections (B-225); "do as the reference, we agreed on it for a reason". Tabs and filters: active state in the tenant's theme, outline with a subtle fill (as configured before); date pickers per B-227.

- [ ] **B-229** On leave: dates and a type on a person, shown wherever the person appears (Performance included); slice 6's row, not in this session's ask · Core HR, Performance · 2026-10-31

- [ ] **B-230** Demo photos for Carthage's people (slice 6's row); every page draws initials today · Core HR · 2026-10-31

- [ ] **B-231** Access tab › History (the drawn account story: invited by, accepted, signed in); Identity has no per-person account history read yet · Identity, Core HR · 2026-10-31

- [ ] **B-200** Reorder list values by drag and drop (a handle on each row) instead of up and down arrows, in Settings › Lists; reuse the milestone editor's drag if it fits · Core HR · 2026-10-30

- [ ] **B-201** Make the Places table richer: it does its job but reads lackluster (user 2026-10-30, not urgent) · Core HR · 2026-10-30

- [ ] **B-194** Remove the legacy employee write endpoints (`POST /employees`, `PUT /employees/{id}`, rehire, terminate, change-manager) and their commands: no screen calls them; B-175 had to move them onto job and place ids anyway · Core HR · 2026-10-30

### Deferred UI work

Explicitly deferred; no change to the deferral or review verdict.

- [ ] **B-250** Sidebar collapse/expand affordance still unresolved; revisit in a later UI pass · Shared · 2026-11-03
      User rejected both the wide toggle and the compact-chevron revision. Explicitly deferred 2026-11-03: leave the current UI as-is; do not treat it as accepted or continue this session.

  - [ ] **B-274** Redesign the sidebar toggle after rejected review attempts · Shared · 2026-11-03
        Deferred with B-250. Compact header chevrons did not resolve the user's concern.

- [ ] **B-239** Restyle the Add a person page (B-199's `/core/people/add`) · Core HR · 2026-10-31
      User 2026-10-31 (B-182 review): "mark add person screen for restyling later".

## Needs discussion


- [ ] **B-169** Core HR after the rebuild: the rungs chosen at checkpoint 2 to keep for later, so they aren't lost · Core HR, Shell · 2026-10-30
      From B-164's scope page (brief §6b). Each is the next rung above what B-167 builds.
  - [ ] **B-170** Companies arrange the person page's sections from their own fields (P1 rung 3) · Core HR · 2026-10-30
        User: "Showcase is a nice to have, record it for now".
  - [ ] **B-171** AI data health: likely duplicates, odd job titles, managers with too many reports, with proposed fixes (P4 rung 3) · Core HR · 2026-10-30
        User: "Keep ai for later nice to have potentially".
  - [ ] **B-172** A weekly people digest by email: joiners, leavers, changes, celebrations (D1 rung 3) · Core HR, Shell · 2026-10-30
        User: "Record Weekly digest for later".
  - [ ] **B-174** E-signature: HR sends documents to sign; people sign in Fusion; the signed copy and signing record stay on the person (pulled back at checkpoint 2, then parked) · Core HR · 2026-10-30
        User: "e-signature can stay on nice to haves for now recorded". Shape if built: brief §6b (E1), on top of documents on a person.
- [ ] **B-147** Fusion assistant: one AI assistant across the app that answers questions from the tenant's own data (people, org, goals, reviews, conversations) through retrieval over our modules, within what the asker may see; another wow feature for the demo. Decide scope, which modules it reads first, and how it respects permissions (retrieval runs as the asker, never a wider index) · Shell, Core HR, Performance · 2026-10-28
      User 2026-10-31: the change drafter (B-179) could use it too, as a wow factor rather than a need; today it sends the company's whole lists, which fits.
      User 2026-10-30: depends on whether our modules are complete (B-163, part of B-164, checks that).
      2026-10-30, B-164 scope: questions about people in plain words (D2 rung 3, reports) land here; "describe a change" (I2) is built in B-167 and can share its AI plumbing.
- [ ] **B-111** A proper landing page for Fusion: the public front door before sign-in · Shell · 2026-10-24
      User idea; research and artifact together with B-110 (now under B-164): the tenant-branded sign-in and the public landing page are two faces of one front door. Today visitors who aren't signed in go straight to `/auth/signin`.
      2026-10-30, B-164 scope: branding stops short of the company's own web address; that address belongs here, with hosting.
- [ ] **B-053** Complete the production evidence storage gate · Performance · 2026-10-08
      The tenant retention setting and app-side expiry are implemented under B-056. Production use remains gated until a private shared object store is selected, backup/restore is tested, and malware scanning is in place. Provider selection is still undecided. See [plan](plans/B-053-performance-evidence-storage.md).
