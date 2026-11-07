# STATE - live handoff

**Last finished:** B-239 with B-312 (Add a person as direction C, filling the manager's open role), 2026-11-07, accepted.

## Active work

**B-313** batch: B-204 branded notification emails, B-231 Access › History, B-229 on leave, B-212 roles reaching "their unit". Plan: `plans/B-229-batch-leave-history-reach-emails.md` (approved 2026-11-07).

- Decided with the user: explorer first, then three builds, one commit each (1: B-204 + B-231; 2: B-229; 3: B-212, security review).
- **Session 0 done (2026-11-07):** explorer `plans/B-313-explorer.html`, published at https://claude.ai/artifact/45gU5RWQJR8gqbekvF8Uy7. Screens: Set leave (Make a change › Leave sheet), Aicha's page (scheduled / on leave now / back; viewer HR, manager, teammate), Everywhere else (People list and cards, org chart, My team, Mariam's Home, Aicha's own page, Performance Your people), Access › History (signs in / invited, failed then sent again / withdrawn), Roles table (example role "Product leads" with their unit), Role page (reach menu + preview of Mariam's unit: Product and the units under it, 16 people besides her vs 5 in her team), Email (today vs branded, Carthage #2f5fd0).
- Recommendations preselected: leave type visible to HR and the manager only (others see "On leave"); pill + glance cell; open-ended leave allowed; leave follows the company's approval rules; History newest first; "their unit" = the unit they work in and every unit under it (units have no heads; Managers keep "their team"); email exactly like the invitation.
- **Picks in (2026-11-07):** every recommendation; recorded in the plan under "Picks".
- **Session 1 done (2026-11-07):** B-204 + B-231 built, committed, In review (see LOG). Waiting on the user's look at the two screens.
- **Next (fresh session): Session 2, B-229 On leave** per the plan's Session 2: `WorkforceChangeKind.Leave` (type from Leave types, from, until or open-ended) reusing scheduling, cancel and approvals, or a `LeavePeriod` if the change model can't carry an open end; one migration; `OnLeave` on the band, People rows/cards, org chart node, My team, Home coming-up and `WorkforceSnapshot` (Performance shows it, pauses nothing); Make a change › Leave sheet; en/fr/ar; tests incl. cross-tenant and who-can-set negatives; one screen of leave on the person page.
- After the picks: sessions 1–3 per the plan, each fresh, each ends In review with one screen per new surface.

## Next

Not set: take it from the user or the board.
