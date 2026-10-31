# B-178 — Administrators, seeing Fusion as someone, the old token roles retired (slice 4 of B-167)

Built 2026-10-31 from D-25 and the accepted drawing (explorer 3b, Roles › Administrators and Seeing as someone; [artifact](https://claude.ai/artifact/V2bfDx2cEZ8s37XQjVgekM)). Screens: `plans/B-178-screens/` (dark, 1440×900, Carthage · Mid-year as Amira Khelifi, the administrator); the drawing's frames beside them as `ref-*`. Data: `data/screens-b178-administrators.cjs` made Nour Ben Ali (Chief People and Operations Officer) Mid-year's second administrator.

## What to look at

1. **Administrators** (`02`, `03`, `04`; Settings › Roles › Administrators, or the Administrators column in the roles table). Who, with "1 of at least 2" and its two segments, a slot per administrator (since when, how they came) and the empty slot with Add; the add sheet (only people who already sign in can be picked, invited people who haven't are shown greyed, your password, "Recorded in Change history"); "Everything at <company>", locked; History, every grant and removal kept. The ⋯ on a slot removes someone (or lets you step down); at two it says why it can't.
2. **See Fusion as someone** (`05`, `06`, `07`). On a role page, next to Save: "See Fusion as <the person the preview looks through>". It opens Fusion as them, read-only, with the bar across the top (their roles as pills, Back to Roles). Everything you see is what their own sign-in would show; nothing can be changed. Back returns to the role page. Recorded in Change history (`08`).
3. **Is the bar right?** It follows the drawing (dark-on-light inverse bar, 50px). I added "Nothing can be changed" on its right; is that one line welcome or noise?

## Server rules (evidence: `journey-b178-administrators.cjs` 45/45; Identity and Core HR suites)

- Never fewer than two once there are two: removing or suspending one that would leave fewer is refused (one already short can still add). Two concurrent removals of three can't both commit.
- Adding asks for the caller's own password (five wrong tries lock the check for a few minutes) and takes only someone with an active account and membership in this company; another company's people, accounts without a password and Fusion's operators are refused. The old password-less grant and the email invitation for new administrators are gone.
- Seeing as someone: administrators only, never as yourself, only someone in your company; a 30-minute token with the person's own authority and no refresh token; every change is refused by Gateway, Identity, Core HR, Performance, Learning and Interview; ending it, its expiry or the viewer losing their administration turns the token away on the next request.
- Token roles retired: tokens carry only the operator marker and Learning's HRAdmin copy (derived from permissions when the token is made); nothing of ours reads roles. Identity's old invitation and user endpoints are gone (B-173: an HR holder could mint, list and revoke "OrgAdmin" invitations, though none could be accepted); Learning's `GET /identity/users` stays.
- B-213: a role change (by rule, by edit, by delete) and being made an administrator turn the person's old token away at once; the browser's refresh brings the new permissions without signing them out. Losing administration still ends the sessions.

## Deviations from the drawing

- The drawing has two slots; with three or more each administrator gets a slot and the dashed one stays for adding.
- "See Fusion as" lands on their Home; the drawing's frame shows a person page (`07` is that page as Mariam).
- Buttons that change things stay visible while seeing as someone and the server refuses them (B-220 makes them inert like the drawing's).

## Side by side

| Ours | Drawing |
|---|---|
| ![](B-178-screens/02-administrators-one.png) | ![](B-178-screens/ref-02-administrators-one.png) |
| ![](B-178-screens/03-add-sheet.png) | ![](B-178-screens/ref-03-add-sheet.png) |
| ![](B-178-screens/04-administrators-two.png) | ![](B-178-screens/ref-04-administrators-two.png) |
| ![](B-178-screens/05-role-see-as.png) | ![](B-178-screens/ref-05-role-see-as.png) |
| ![](B-178-screens/07-seeing-as-person.png) | ![](B-178-screens/ref-07-seeing-as-person.png) |

Also: `01-every-role-one-administrator` (the table's warning count), `06-seeing-as-home`, `08-change-history`.

- [ ] Administrators page reads like the drawing
- [ ] The add sheet: picking, greyed invitees, password
- [ ] The bar while seeing Fusion as someone
