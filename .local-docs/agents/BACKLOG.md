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
- **IDs:** unique, never reused; next is one above the highest ever used (check `LOG.md`). **Next ID: B-175.**
- **Review gate:** only noticeable, judgment-dependent work goes to In review. Evidence-settled work (backend, refactors, config, small or as-asked fixes) closes straight to `LOG.md` with ○.
- **Closing:** user approval in conversation (or a ticked box) closes ✓; a complaint becomes a Ready child and the parent stays In review.

## In progress

- [ ] **B-164** The tenant experience, rebuilt from first principles: from a new tenant administrator's first sign-in to everyday use by every role, design-first, coherent and demo-ready; Core HR reworked deepest, Performance checked at its seams · Core HR, Shell, Performance · 2026-10-30
      User 2026-10-30, before any other task: Core HR was winged without specs and feels dated; clean it up, remove/merge/redesign/re-architect, BambooHR-like, no vibe-code feel, the same way as the Performance rework (research, recommendations, an interactive artifact, taste questions). Platform admin out. Order: thin map → independent target → the audit is the diff, in one explorer → decisions → rebuild → tour. [plan](plans/B-164-tenant-experience-overhaul.md)
  - [ ] **B-173** Check whether an HR admin can make someone a tenant administrator through Identity's old invitation endpoint (`POST /api/identity/tenants/{id}/invites` with role "OrgAdmin" is not refused), bypassing the administrator invitation flow and its continuity lock · Identity · 2026-10-30
        Found answering the user's A2 note (brief §6b, Platform roles). The operator side was checked in code and holds: both old endpoints require the caller's own membership. Verify this one with an API journey (create, inspect, revoke), and if it's live fix it with `security-review` ahead of B-167, which retires these endpoints with the token-role copy anyway.
  - [ ] **B-146** Celebrations: birthdays and work anniversaries on Home (BambooHR-style life), once B-127 stores dates of birth; decide who sees a birthday (day and month only) · Shell, Core HR · 2026-10-28
        User 2026-10-30: lowest priority. Later that day it came into B-164's scope as part of D1 "Core HR on Home" (rung 2: birthdays if people opt in, work anniversaries); built in B-167.
  - [ ] **B-110** Tenant configurability as a hero: branding (logo, theme/accent, branded sign-in, own address, email branding) and internal configuration (company defaults and whatever the research puts on the ladder), depth chosen on B-163's scope page · Shell, Platform, Core HR, Identity · 2026-10-24
        User 2026-10-30: "I really wanna establish it as a core wow factor"; EY discussed it a lot but never gave specs or how far to take it. Earlier (2026-10-24) brain dump, ideas not requirements. A tenant's default language meets B-105. Context: B-071 removed the unused brand colour from Core's branding settings; Core's branding settings store a `LogoUrl` that no screen sets or shows; Company settings show name and locale.
  - [ ] **B-166** Explorer and decisions: one artifact showing the target journey per persona, a verdict on every existing surface (keep, redesign, merge, remove) and every missing one, the catalogue to pick from and the tour moments; the user's verdict becomes the decisions document · 2026-10-30
        2026-10-30: checkpoint 3a closed: the feel is set by three accepted screens (Aicha's page, the brand studio, Home on day one after five drafts), D-01–D-09 in [decisions](plans/B-166-decisions.md); [explorer](https://claude.ai/artifact/NzayZdgpvuCE3oUQk5s2CH). Next: the whole journey on the same page, in a fresh session.
  - [ ] **B-167** Rebuild: slices in dependency order, each end to end with screens for the taste check; split into children once decisions are accepted · 2026-10-30

## In review

- [ ] **B-104** Final manual verification pass, once the big features are done (Settings, any wow feature): the user verifies B-089 phase 2 and everything since by hand, then the little stuff that's left · Performance · 2026-10-23
      2026-10-29: the fixes are done (B-089 audit, phase 2 committed ba8f58af, which also closed B-088's ask); only the user's hand check is left, so this sits In review.
      User: "once we establish a bunch of things and the big features all done and only the little stuff left, maybe we'll do a manual thing right there and verify everything". B-089 phase 2 waits on it; committed 2026-10-25 at the user's request (ba8f58af), still unverified by hand.
  - [ ] **B-089** Cross-slice polish: one critical pass over the UI/UX, ergonomics, routing and architecture of everything slices 1–6 built, then fix what it finds · Performance · 2026-10-20
        User: "a final cleanup pass over the ui/ux and ergonomics in general of the totality of the slices feature, screens and architecture, looking at it in ergonomic constructive critical lenses". Runs after the demo seeder (B-095) so every phase can be audited live, and before Settings. Audit first (ranked findings with screenshots, dark 1440×900), then fixes. Absorbs B-088, B-080, B-085, B-097 and B-100. Phase 1 done 2026-10-23: [findings](plans/B-089-cross-slice-polish.md) (24, batches A–J). Phase 2 (user: "do whats best"): A, B, C, E, F, H, I done; D, G, J partial (see the doc's "Phase 2" section). Committed `ba8f58af`. The user will verify it later, by hand, in **B-104** (not to be accepted as is now). Look at then: `plans/B-089-screens/after/` and the Phase 2 table in the doc.
    - [ ] **B-088** Final polish of the slice 3 surfaces (1:1s, Feedback, requests, praise): specific UI/UX, routing, layout and design · Performance · 2026-10-19
          User, locking B-087 in: "generally its not bad, although idk if its gonna be the final polish, in terms of specific ui ux and routing and layout and design". Folded into B-089.

## Ready

- [ ] **B-090** Product tour: an interactive walkthrough that takes a new tenant from the platform admin's invite through its first real use of Fusion · Shell, Core, Performance · 2026-10-20
      User: another wow factor that, done right, also carries a realistic demo from the tenant's point of view, "taking over after the initial platform admin invite". Open: where it starts and ends, who it's for (tenant admin, HR, manager, employee), guided steps vs. checklist vs. contextual hints, and whether it runs on real or demo data. Best after B-089 and the demo seeder, so it walks finished screens.
      User again 2026-10-29: onboard the person in real time, a tutorial that shows them around and guides them to set up their things; would carry the demo too. No details yet, discussion first.
      User 2026-10-30: "i would want a product tour, its a good prio feature". Next up; starts with a decision page (where it starts and ends, who it guides, how it moves through real screens) before any code.
      User 2026-10-30, later: the tour needs cleanly engineered features first, so it follows B-164; its storyline is B-166's journey, and the explorer marks the tour-worthy moments.
      User 2026-10-30, checkpoint 2: consolidate with B-164's setup guide (F1). One guidance system: the setup guide on Home is the tour's administrator track; each step opens the real screen where the tour takes over. B-167 builds the guide for the tour to extend.
- [ ] **B-168** A deep link that opens a change on a person's record (`?change=job|end`) leaves the address without `/core`, so a refresh lands outside Core HR · Core HR · 2026-10-30
      Found in the B-165 walk. `features/people/changes/change-sheet.tsx` passes `usePathname()` (basePath-less) to `history.replaceState`. Small fix; may be overtaken by B-167 if the record is rebuilt.

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
      User 2026-10-30: depends on whether our modules are complete (B-163, part of B-164, checks that).
      2026-10-30, B-164 scope: questions about people in plain words (D2 rung 3, reports) land here; "describe a change" (I2) is built in B-167 and can share its AI plumbing.
- [ ] **B-111** A proper landing page for Fusion: the public front door before sign-in · Shell · 2026-10-24
      User idea; research and artifact together with B-110 (now under B-164): the tenant-branded sign-in and the public landing page are two faces of one front door. Today visitors who aren't signed in go straight to `/auth/signin`.
      2026-10-30, B-164 scope: branding stops short of the company's own web address; that address belongs here, with hosting.
- [ ] **B-053** Complete the production evidence storage gate · Performance · 2026-10-08
      The tenant retention setting and app-side expiry are implemented under B-056. Production use remains gated until a private shared object store is selected, backup/restore is tested, and malware scanning is in place. Provider selection is still undecided. See [plan](plans/B-053-performance-evidence-storage.md).
