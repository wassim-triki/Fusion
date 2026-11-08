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
- **IDs:** unique, never reused; next is one above the highest ever used (check `LOG.md`). **Next ID: B-331.**
- **Review gate:** only noticeable, judgment-dependent work goes to In review. Evidence-settled work (backend, refactors, config, small or as-asked fixes) closes straight to `LOG.md` with ○.
- **Closing:** user approval in conversation (or a ticked box) closes ✓; a complaint becomes a Ready child and the parent stays In review.

## In progress

None.

## In review

None waiting.

## Ready

### Big features

Each is a project of its own: a decision page first, then sessions.

- [ ] **B-090** Product tour: an interactive walkthrough that takes a new tenant from the platform admin's invite through its first real use of Fusion · Shell, Core, Performance · 2026-10-20
      User: another wow factor that, done right, also carries a realistic demo from the tenant's point of view, "taking over after the initial platform admin invite". Open: where it starts and ends, who it's for (tenant admin, HR, manager, employee), guided steps vs. checklist vs. contextual hints, and whether it runs on real or demo data. Best after B-089 and the demo seeder, so it walks finished screens.
      User again 2026-10-29: onboard the person in real time, a tutorial that shows them around and guides them to set up their things; would carry the demo too. No details yet, discussion first.
      User 2026-10-30: "i would want a product tour, its a good prio feature". Next up; starts with a decision page (where it starts and ends, who it guides, how it moves through real screens) before any code.
      User 2026-10-30, later: the tour needs cleanly engineered features first, so it follows B-164; its storyline is B-166's journey, and the explorer marks the tour-worthy moments.
      User 2026-10-30, checkpoint 2: consolidate with B-164's setup guide (F1). One guidance system: the setup guide on Home is the tour's administrator track; each step opens the real screen where the tour takes over. B-167 builds the guide for the tour to extend.
- [ ] **B-105** Real internationalization: English, French and Arabic fully configured across our modules (Arabic means right-to-left layouts too); screens are done in all three, only server text (B-116) is left and parked · Shell, Core HR, Performance, Platform · 2026-10-23
      From B-071 C-6: the switch lives in Settings > Preferences. 2026-10-24, user: wants EN/FR/AR later, so "remove the switch" is off the table. To discuss: how translations are stored and loaded, dates and numbers per locale, RTL in `@repo/ds`, server text (emails, notifications, errors); a company's default language is set in Settings › Brand (B-176).
      2026-10-24: agreed to settle the foundation first (translation library and message format; start/end instead of left/right in `@repo/ds` and our apps, lint-guarded) because every new screen adds cost. Decision page delivered: [artifact](https://claude.ai/artifact/R1x8YyFNNTf4qsHVBph1U9) (`plans/B-105-internationalization.html`). User 2026-10-24: language lives on the account (I-3); colleagues' modules only must not crash; we draft translations, no native reviewer; the rest as recommended. Phase 1 proposed as OpenSpec `add-i18n-foundation` (strict-valid, 11 tasks): account language in Identity + `NEXT_LOCALE` from `@repo/auth`, next-intl wired in our four apps via `@repo/i18n` with Preferences translated EN/FR as proof, start/end layout + lint guard, one place for dates and numbers. Preconditions met 2026-10-25 (polish pass and Settings committed, Settings change archived): ready to apply in a fresh session.
      2026-10-25: phase 1 (the groundwork) accepted (user moved on: "Just proceed"), archived as `2026-10-25-add-i18n-foundation`, uncommitted for the user to commit. Phases 2–5 are the children below, in the decision page's order.
      2026-10-25: phase 2 (B-113, the frame in English and French) accepted (user: "proceed"), uncommitted for the user.
      2026-10-26, user: get internationalization done fast and move on. The demo shows a few screens at most; the goal is the feature working in French and Arabic, not perfection. Remaining children run lean: translate what renders, no per-area screens or polish, one French/Arabic test per module.
      For the Arabic phase: the CSS build maps logical insets to left/right through `:lang(ar …)`, so `<html lang>` must be set with `dir`; sheet sides, slide animations and time-axis charts are still physical.
  - [ ] **B-116** Phase 5: server text in the person's language: emails per recipient, notification and error codes rendered on screen, change history as data · Identity, Core HR, Performance · 2026-10-25
        From B-114 D8: AI output (plan coach, review starters, calibration summaries) answers in the person's language.
        2026-10-26, user: skip for now ("skin b116 for now"); French and Arabic screens are done (B-114, B-115 closed). Not next.
      User 2026-10-30: B-116 is low priority for now.
- [ ] **B-245** The import groups titles into job families when the files have no family column (D-23 widened the AI to it): suggestions marked with the sparkle, each family changeable on the chart's Jobs view · Core HR · 2026-11-01

### Before hosting

Security and scale that must hold once Fusion is online; nothing changes in the demo.

- [ ] **B-296** Prove a single sign-on domain by DNS before Fusion is hosted: today the first company to pass a test sign-in from a domain proves it, so a company running its own provider could claim another company's unclaimed domain and show its button on that domain's sign-in page · Identity, Core HR · 2026-11-05
      Found in the B-191 security review (accepted rung 2 in the plan, D9). A claim never signs anyone in across companies; the risk is the sign-in page steering another company's people to that provider. Fix: a DNS TXT record per domain, checked before it counts as proved.
- [ ] **B-310** Before hosting: the Gateway and Identity trust a forwarded client address only from loopback, so once the shell, Gateway and Identity run on separate machines each needs its hop's address in `KnownProxies`, and a shell behind a load balancer needs the stamp to take the balancer's address instead of the socket · Shell, Gateway, Identity · 2026-11-07
- [ ] **B-255** Scale Reports filter values with viewer-scoped server search when company data grows; report runs currently return the complete allowed value set.

### Cleanup and tooling

- [ ] **B-328** Delete the old-address redirect pages and the links that still use them: Core's `/employees`, `/employees/[id]`, `/employees/import`, `/workforce-access`, `/setup`, `/people/hire`, `/people/add-existing`, `/people/[key]/performance`, `/profile/performance`; the top bar search's Hire still opens `/core/people/hire`; tests and the route skeleton list still name some of them · Core HR, Shell · 2026-11-08
      Found reviewing the whole app, 2026-11-08. No backward compatibility (AGENTS.md), so the redirects go rather than stay.

### Parked

- [ ] **B-230** Parked by the user, 2026-11-06; don't offer it again unprompted. Demo photos for Carthage's people (slice 6's row); every page draws initials today · Core HR · 2026-10-31

## Needs discussion

### Big features

- [ ] **B-329** Time off: leave types, requests and approvals, balances, a team calendar. Today "on leave" is only a status HR sets on a person (B-229). A pillar of BambooHR and HiBob, so the jury will compare · Core HR, Shell · 2026-11-08
      Found reviewing the whole app, 2026-11-08. Decide whether it's in scope before the product tour (B-090), so the tour walks it. Pay is left out too (the import drops salary columns on purpose); decide it in the same talk.

- [ ] **B-147** Fusion assistant: one AI assistant across the app that answers questions from the tenant's own data (people, org, goals, reviews, conversations) through retrieval over our modules, within what the asker may see; another wow feature for the demo. Decide scope, which modules it reads first, and how it respects permissions (retrieval runs as the asker, never a wider index) · Shell, Core HR, Performance · 2026-10-28
      User 2026-10-31: the change drafter (B-179) could use it too, as a wow factor rather than a need; today it sends the company's whole lists, which fits.
      User 2026-10-30: depends on whether our modules are complete (B-163, part of B-164, checks that).
      2026-10-30, B-164 scope: questions about people in plain words (D2 rung 3, reports) land here; "describe a change" (I2) is built in B-167 and can share its AI plumbing.
- [ ] **B-111** A proper landing page for Fusion: the public front door before sign-in · Shell · 2026-10-24
      User idea, first paired with B-110 (closed 2026-11-08, branding built): the tenant-branded sign-in and the public landing page are two faces of one front door. Today visitors who aren't signed in go straight to `/auth/signin`.
      2026-10-30, B-164 scope: branding stops short of the company's own web address; that address belongs here, with hosting.
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

### Polish

- [ ] **B-330** Two pages show one person's performance: Performance's own person page (opened from Team and from a review record) and the Performance tab of the Core HR person page. Check in the walkthrough whether they should become one · Performance, Core HR · 2026-11-08

### Before hosting

- [ ] **B-053** Complete the production evidence storage gate · Performance · 2026-10-08
      The tenant retention setting and app-side expiry are implemented under B-056. Production use remains gated until a private shared object store is selected, backup/restore is tested, and malware scanning is in place. Provider selection is still undecided. See [plan](plans/B-053-performance-evidence-storage.md).
