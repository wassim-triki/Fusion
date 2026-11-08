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
- **IDs:** unique, never reused; next is one above the highest ever used (check `LOG.md`). **Next ID: B-321.**
- **Review gate:** only noticeable, judgment-dependent work goes to In review. Evidence-settled work (backend, refactors, config, small or as-asked fixes) closes straight to `LOG.md` with ○.
- **Closing:** user approval in conversation (or a ticked box) closes ✓; a complaint becomes a Ready child and the parent stays In review.

**Workstreams:** only the numbered slices in [B-167](plans/B-167-rebuild.md) are rebuild slices. Follow-ups, product features, maintenance and deferred UI are other work; grouping does not make them extra slices.

| Rebuild slice | Task | Status |
| --- | --- | --- |
| 1–16 | Jobs/places/lists through the Core HR front page | Accepted and closed |
| 17 · B-191 | Single sign-on | Accepted and closed |
| 18 · B-192 | Seams and finish | Accepted and closed |
| 19 · B-298 | Carthage as the one company to walk around in | Accepted and closed |

## In progress

- [ ] **B-320** UI and design batch: one tab pattern, Performance lists with titles inside, a fuller sign-in company column, a richer Places table, one word for growth goals (user 2026-11-08: "batch the most from ui and design in 1 batch without losing quality") · Shell, Core HR, Performance, `@repo/ds` · 2026-11-08
      Sessions: 0 explorer (drawings for every taste piece) → 1 B-198 tabs (✓ 2026-11-08) → 2 B-228 Performance lists (✓ 2026-11-08) → 3 B-210 + B-201 + B-301 (In review). Left out: B-230 (parked), B-250/B-274 sidebar toggle (deferred after rejected attempts). [plan](plans/B-320-ui-design-batch.md)

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

- [ ] **B-210 · B-201 · B-301** (B-320 session 3) Sign-in's company column (B-210), a richer Places table (B-201), one word for growth goals (B-301) · Shell, Core HR, Performance · built 2026-11-08
      Look at (dark, 1440×900, `plans/B-320-screens/`): 07 Carthage's sign-in, its welcome line (new Settings › Brand › Welcome line, set by `data/set-carthage-welcome-line.cjs`) and the ring shape in its colour; 08 Settings › Places as Amira Khelifi, the administrator: faces, share of the company, teams. B-301 is wording only: Performance's Overview and Team now say "development goals" (en/ar; fr already did). Deviation: the shape is one ring drawing in the company colour, not traced from each logo.

## Ready

- [ ] **B-310** Before hosting: the Gateway and Identity trust a forwarded client address only from loopback, so once the shell, Gateway and Identity run on separate machines each needs its hop's address in `KnownProxies`, and a shell behind a load balancer needs the stamp to take the balancer's address instead of the socket · Shell, Gateway, Identity · 2026-11-07

### Rebuild slices

### Other work

- [ ] **B-321** The remaining Performance lists with headings on the canvas: the 1:1 record (`PlanSection`: talking points, actions, notes, past meetings) and the Reviews page and round page (`SectionHeading`). Same move as B-228: DS `Section`, rows inside, then delete `PlanSection` and `SectionHeading` · Performance · 2026-11-08

- [ ] **B-249** The brand studio's Home preview draws the real Home (day one's guide, the company card) instead of its stand-in (from B-188's notes) · Core HR · 2026-11-01
      User 2026-11-08: left out of B-320 for now.

- [ ] **B-314** Access › History tells role grants too (given by whom, when; removed): removing a grant deletes its row today, so grants need a kept history first; B-231 ships the account story without them · Identity, Core HR · 2026-11-07
- [ ] **B-311** Later check: rules defined once, not redefined. Password rules first, then anything like them (address checks, length limits, …): find each rule's copies across the backend and frontends, keep one source, and make the rest read from it · Identity, Shell, Core HR · 2026-11-07
      User 2026-11-07: park it, check and fix later; main things first. Known copies of the password rules: Identity's `AccountPasswordPolicy` (the source, sent to forms as `passwordRequirements`); its checklist re-coded in the shell's `lib/activation.ts` (`passwordChecks`) and again in `@repo/auth` `password-reset-page.tsx` (`requirementChecks`, B-295), each with its own words; `@repo/ds` `PasswordStrengthField` scores strength on its own assumed minimum of 10.

- [ ] **B-296** Prove a single sign-on domain by DNS before Fusion is hosted: today the first company to pass a test sign-in from a domain proves it, so a company running its own provider could claim another company's unclaimed domain and show its button on that domain's sign-in page · Identity, Core HR · 2026-11-05
      Found in the B-191 security review (accepted rung 2 in the plan, D9). A claim never signs anyone in across companies; the risk is the sign-in page steering another company's people to that provider. Fix: a DNS TXT record per domain, checked before it counts as proved.
- [ ] **B-299** Administrator Suspend/Reactivate and the `TenantAdministrator` invitation purpose are now unreachable from the product: only tests and a database constraint keep them. Remove them, or say what they are for · Identity · 2026-11-06

- [ ] **B-300** The backend still says "Tenant Administrator" in role names, mail and audit, while screens say "Administrator" since B-192 · Identity · 2026-11-06


- [ ] **B-277** Resolve archive collisions for completed review plans · Tooling · 2026-11-03
      Stack startup repeatedly reports `archive/plans/B-189-reports.md exists; left B-189-reports.md in plans/`. Compare and preserve both copies’ information before clearing the completed plan from the active folder.

- [ ] **B-255** Scale Reports filter values with viewer-scoped server search when company data grows; report runs currently return the complete allowed value set.


- [ ] **B-245** The import groups titles into job families when the files have no family column (D-23 widened the AI to it): suggestions marked with the sparkle, each family changeable on the chart's Jobs view · Core HR · 2026-11-01


- [ ] **B-220** While seeing Fusion as someone, show changes as inert (the drawing's "Propose a change" greyed) instead of letting the server refuse them: today every write is refused server-side (403 "Nothing can be changed while seeing Fusion as someone") and forms show that error · Shell, Core HR, Performance · 2026-10-31
      Found building B-178. A shared "is viewing" flag from `@repo/auth` (`useViewAs`) that action buttons read.

- [ ] **B-221** Administrator invitations issued before B-178 can still be accepted, but nothing lists or revokes them now (the customer-side email invitation retired: only people who already sign in can be made administrators). List them on the Administrators page with Revoke, or expire them · Identity, Core HR · 2026-10-31

- [ ] **B-222** Clean up what the old Administrators workspace left: Core HR's `admins` message namespace, the `/access` route skeletons, suspend/reactivate (still enforced by the two-administrator rule, no screen offers them), and the invite acceptance's Employee/Manager label from `InviteToken.Role` · Core HR, Identity · 2026-10-31

- [ ] **B-203** Brand changes in Change history: a save in Settings › Brand is stored in Identity and isn't in Core HR's change history yet; fold into the unified audit (see the audit-history-deferred note) · Identity, Core HR · 2026-10-30


- [ ] **B-202** `fusion-dev` script that adds an EF migration without stopping the running service (build to the artifacts path, then `dotnet ef … --no-build` against it); B-175 had to stop CoreHR for it · Tooling · 2026-10-30
      Recipe that worked in the B-287 batch (2026-11-07), to wrap in the script: environment `UseArtifactsOutput=true` and `ArtifactsPath=<temp folder>`, `dotnet restore <project>`, then `dotnet ef migrations add <Name> --project … --startup-project … --output-dir Infrastructure/Persistence/Migrations`.

- [ ] **B-090** Product tour: an interactive walkthrough that takes a new tenant from the platform admin's invite through its first real use of Fusion · Shell, Core, Performance · 2026-10-20
      User: another wow factor that, done right, also carries a realistic demo from the tenant's point of view, "taking over after the initial platform admin invite". Open: where it starts and ends, who it's for (tenant admin, HR, manager, employee), guided steps vs. checklist vs. contextual hints, and whether it runs on real or demo data. Best after B-089 and the demo seeder, so it walks finished screens.
      User again 2026-10-29: onboard the person in real time, a tutorial that shows them around and guides them to set up their things; would carry the demo too. No details yet, discussion first.
      User 2026-10-30: "i would want a product tour, its a good prio feature". Next up; starts with a decision page (where it starts and ends, who it guides, how it moves through real screens) before any code.
      User 2026-10-30, later: the tour needs cleanly engineered features first, so it follows B-164; its storyline is B-166's journey, and the explorer marks the tour-worthy moments.
      User 2026-10-30, checkpoint 2: consolidate with B-164's setup guide (F1). One guidance system: the setup guide on Home is the tour's administrator track; each step opens the real screen where the tour takes over. B-167 builds the guide for the tour to extend.

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


### Other work — follow-ups from earlier rebuild slices

These keep their original scope and connection to B-167/B-192; they are not numbered slices.




- [ ] **B-230** Parked by the user, 2026-11-06; don't offer it again unprompted. Demo photos for Carthage's people (slice 6's row); every page draws initials today · Core HR · 2026-10-31



- [ ] **B-194** Remove the legacy employee write endpoints (`POST /employees`, `PUT /employees/{id}`, rehire, terminate, change-manager) and their commands: no screen calls them; B-175 had to move them onto job and place ids anyway · Core HR · 2026-10-30

### Deferred UI work

Explicitly deferred; no change to the deferral or review verdict.

- [ ] **B-250** Sidebar collapse/expand affordance still unresolved; revisit in a later UI pass · Shared · 2026-11-03
      User rejected both the wide toggle and the compact-chevron revision. Explicitly deferred 2026-11-03: leave the current UI as-is; do not treat it as accepted or continue this session.

  - [ ] **B-274** Redesign the sidebar toggle after rejected review attempts · Shared · 2026-11-03
        Deferred with B-250. Compact header chevrons did not resolve the user's concern.

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
