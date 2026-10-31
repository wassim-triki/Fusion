# B-180 One person page — review

Slice 6 of B-167 (D-01, D-16), with B-195 (job family and level) and B-214 (Personal details keys). Screens: `plans/B-180-screens/` (dark, 1440×900), each beside the drawing's frame `ref-*`.

## What to look at

| Screen | Beside | Look for |
|---|---|---|
| `01-overview-hr.png` | `ref-01-overview.png` | Band: big photo, glance row (manager, team, time with the company, place), Make a change + ⋯ at top right, tabs in the band with the active one in the company's color (outline, subtle fill). Rail kept. Overview sections stacked, titles inside. |
| `02-more-menu.png` | — | ⋯ menu: Give feedback, Show on the org chart, See it on another date, Copy link, End employment. |
| `03-job.png` | — | B-195: The job (title, family, level, unit, place), then Employment, Job information, history. |
| `04-documents-hr.png` | — | Documents: who sees them (the person and HR), add, download, remove. |
| `05-access-hr.png` | `ref-05-access.png` | Access: account and roles as sections (the drawn History waits on B-231). |
| `06-performance.png` | — | Performance's person page is this tab now; `/performance/people/{id}` opens it. |
| `07-personal-self.png`, `08-personal-self-below.png` | `ref-07-personal.png` | Aicha's own page (`/core/profile`): Contact, Home address, Emergency contacts, Identity, each saying who sees it from the company's roles; locks on what only HR changes (work email, legal name, date of birth). |
| `09-overview-self.png` | — | Her own page opens on Overview with the same band. |
| `10-overview-colleague.png` | — | Omar (a manager elsewhere): Overview and Performance only; no team or tenure in the glance (not his to see). |

## Calls made (say if any is wrong)

- **Who sees each** is read from the roles: the mobile reaches "you, your managers" plus every role that sees personal details for everyone; the rest only roles that change them. Carthage's leftover journey roles (Payroll desk, Performance lead) show up in the Contact line because they hold that reach.
- **Date of birth** is HR's now (the drawing locks it): the person can't change it; the server refuses it.
- **Documents** are personal details: the person and HR, not managers. The person removes what they added; HR removes any. PDF and images, 10 MB.
- **Personal keys** (B-214): `core.personal.view` (team, everyone) and `core.personal.manage`. Every existing role kept exactly what it had (grants copied one for one), so nothing changes until someone edits a role; the role editor no longer moves Jobs and Personal together.
- **Not drawn yet, boarded:** About (B-232, with B-181's fields), on leave (B-229), demo photos (B-230), Access › History (B-231). Coming up on Overview shows Core HR's items and the work anniversary; Performance's 1:1s and asks there are not wired yet.
